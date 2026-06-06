import pandas as pd
import calendar
from datetime import date, timedelta
from typing import Optional, List, Dict, Any, Tuple

from ui.styles import BLOCK_TYPES
from database.repositories import (
    employees_df,
    shifts_df,
    allocations_df,
    schedule_df,
    add_assignment,
    delete_day_allocation_for_employee,
    delete_day_assignment_for_employee,
    add_allocation,
    get_assignment_by_date_shift,
    build_shift_restriction_map,
    delete_month_schedule,
    heal_apao_agroupada_rules,
    heal_pao_social_rules,
)
from core.rules import (
    month_range,
    iter_days,
    build_shift_time_map,
    shift_start_end_datetimes,
    validate_rules,
    employee_monthly_summary,
)
from core.scheduler import (
    generate_auto_schedule as scheduler_generate_auto_schedule,
    can_work,
    employee_can_receive_flight,
    get_fortnight_group,
)
from core.scheduler_v2 import diagnose_capacity, generate_unified_schedule as run_unified_schedule
from services.exporter_pdf import build_visual_schedule_dataframe

class ScheduleService:
    """Serviço que centraliza a lógica de negócios da escala, auto-geração e auto-reparo."""

    @staticmethod
    def generate_auto_schedule(
        year: int,
        month: int,
        roles_to_generate: List[str],
        clear_existing: bool = True,
        strict: bool = True,
        max_monthly_work: Optional[int] = None,
        target_rests: Optional[int] = None
    ) -> pd.DataFrame:
        """Invoca o motor do gerador automático de escala."""
        return scheduler_generate_auto_schedule(
            year=year,
            month=month,
            roles_to_generate=roles_to_generate,
            clear_existing=clear_existing,
            strict=strict,
            max_monthly_work=max_monthly_work,
            target_rests=target_rests
        )

    @staticmethod
    def diagnose_capacity(year: int, month: int) -> Dict[str, Any]:
        """Diagnóstico de capacidade antes de gerar (motor v2)."""
        return diagnose_capacity(year, month)

    @staticmethod
    def capacity_summary_df(year: int, month: int) -> pd.DataFrame:
        """Tabela resumo de capacidade para a UI."""
        diag = diagnose_capacity(year, month)
        return pd.DataFrame(diag.get("summary_rows", []))

    @staticmethod
    def generate_unified_schedule(
        year: int,
        month: int,
        roles_to_generate: List[str],
        clear_existing: bool = True,
        auto_loop: bool = True,
        max_attempts: int = 8,
    ) -> pd.DataFrame:
        """Geração unificada v2: turnos + folgas + VOO + 6x1 + ciclo até fechar furos."""
        import streamlit as st
        try:
            st.cache_data.clear()
        except Exception:
            pass
        return run_unified_schedule(
            year, month, roles_to_generate,
            clear_existing=clear_existing,
            auto_loop=auto_loop,
            max_attempts=max_attempts,
        )

    @staticmethod
    def spreadsheet_daily_summary(year: int, month: int) -> pd.DataFrame:
        from core.spreadsheet_validator import daily_summary_row
        return daily_summary_row(year, month)

    @staticmethod
    def spreadsheet_coverage_gaps(year: int, month: int) -> pd.DataFrame:
        from core.spreadsheet_validator import list_spreadsheet_gaps
        return list_spreadsheet_gaps(year, month)

    @staticmethod
    def spreadsheet_health(year: int, month: int) -> dict:
        from core.spreadsheet_validator import coverage_health
        return coverage_health(year, month)

    @staticmethod
    def can_employee_take_shift_basic(employee_id: int, work_date: date, shift_code: str) -> Tuple[bool, str]:
        """Validação rápida e robusta usada pelo reparador local interativo."""
        emp_df = employees_df()
        emp_match = emp_df[emp_df["id"] == int(employee_id)]
        if emp_match.empty:
            return False, "funcionário não encontrado"

        emp = emp_match.iloc[0].to_dict()
        start_date, end_date = month_range(work_date.year, work_date.month)

        all_sched = schedule_df(start_date - timedelta(days=1), end_date)
        planned = {}
        if not all_sched.empty:
            for _, r in all_sched.iterrows():
                # ignora o próprio dia do candidato para permitir troca direta
                if int(r["funcionario_id"]) == int(employee_id) and str(r["data"]) == str(work_date):
                    continue
                planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

        alloc = allocations_df(start_date - timedelta(days=1), end_date)
        blocked = {}
        if not alloc.empty:
            for _, r in alloc.iterrows():
                if r["tipo"] in BLOCK_TYPES:
                    blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

        shift_map = build_shift_time_map()
        shift_restrictions = build_shift_restriction_map(work_date.year, work_date.month)

        return can_work(
            emp,
            work_date,
            shift_code,
            blocked,
            planned,
            shift_map=shift_map,
            shift_restrictions=shift_restrictions,
            strict=True
        )

    @staticmethod
    def apply_visual_day_change(
        employee_id: int,
        target_date: date,
        action_type: str,
        value: str = "",
        notes: str = "Ajuste pela Escala Visual"
    ) -> str:
        """Ajuste rápido: troca pré-alocação ou aloca turno em um dia para um funcionário."""
        employee_id = int(employee_id)
        target_date_str = str(target_date)

        # Remove o que existia naquele dia para evitar conflitos operacionais/visuais redundantes
        delete_day_assignment_for_employee(employee_id, target_date_str)
        delete_day_allocation_for_employee(employee_id, target_date_str)

        prealloc_types = {
            "FOLGA",
            "FOLGA PEDIDA",
            "FOLGA SOCIAL",
            "FOLGA AGRUPADA",
            "FOLGA ANIVERSÁRIO",
            "FÉRIAS",
            "DISPENSA MÉDICA",
            "CURSO ONLINE",
            "SIMULADOR",
            "CMA",
            "VOO",
            "ND",
        }

        if action_type in prealloc_types:
            add_allocation(employee_id, target_date_str, action_type, notes)
            return f"Pré-alocação {action_type} aplicada."

        if action_type == "TURNO":
            if not value:
                return "Nenhum turno selecionado."
            add_assignment(target_date_str, value, employee_id, notes)
            return f"Turno {value} aplicado."

        if action_type == "LIMPAR":
            return "Dia limpo para o funcionário."

        return "Ação não reconhecida."

    @staticmethod
    def visual_code_to_action(value: str) -> Tuple[Optional[str], str]:
        """Converte siglas visuais operacionais em ação correspondente."""
        v = str(value).strip().upper()
        mapping = {
            "F": ("FOLGA", ""),
            "FP": ("FOLGA PEDIDA", ""),
            "FS": ("FOLGA SOCIAL", ""),
            "FAG": ("FOLGA AGRUPADA", ""),
            "FA": ("FOLGA ANIVERSÁRIO", ""),
            "FER": ("FÉRIAS", ""),
            "FÉRIAS": ("FÉRIAS", ""),
            "FERIAS": ("FÉRIAS", ""),
            "FÉRIA": ("FÉRIAS", ""),
            "FERIA": ("FÉRIAS", ""),
            "L": ("FÉRIAS", ""),
            "DM": ("DISPENSA MÉDICA", ""),
            "C": ("CURSO ONLINE", ""),
            "K": ("CURSO ONLINE", ""),
            "CMA": ("CMA", ""),
            "EP": ("CMA", ""),
            "S": ("SIMULADOR", ""),
            "V": ("VOO", ""),
            "ND": ("ND", ""),
            "": ("LIMPAR", ""),
            "NAN": ("LIMPAR", ""),
            "NONE": ("LIMPAR", ""),
        }

        if v in mapping:
            return mapping[v]

        if v.startswith("T"):
            return ("TURNO", v)

        return (None, "")

    @staticmethod
    def repair_after_manual_shift(employee_id: int, work_date: date, shift_code: str) -> pd.DataFrame:
        """Garante coerência estrutural ao editar manualmente: remove choque e tenta realocar o deslocado."""
        actions = []
        shift_code = str(shift_code).strip().upper()
        work_date = pd.to_datetime(work_date).date()

        # Localiza quem já estava escalado nesse turno e data específica
        conflict = get_assignment_by_date_shift(work_date, shift_code)
        conflict = conflict[conflict["funcionario_id"] != int(employee_id)] if not conflict.empty else conflict

        # 1. Aloca o novo dono do turno
        delete_day_assignment_for_employee(employee_id, work_date)
        delete_day_allocation_for_employee(employee_id, work_date)
        add_assignment(work_date, shift_code, employee_id, "Ajuste interativo com reparo")
        actions.append({
            "tipo": "APLICADO",
            "data": str(work_date),
            "detalhe": f"Funcionário {employee_id} alocado no turno {shift_code}."
        })

        if conflict.empty:
            return pd.DataFrame(actions)

        # 2. Resolução de conflito: remove o deslocado e busca realocação viável
        for _, row in conflict.iterrows():
            displaced_id = int(row["funcionario_id"])
            displaced_name = row["funcionario"]
            delete_day_assignment_for_employee(displaced_id, work_date)

            emp_row = employees_df()
            emp_row = emp_row[emp_row["id"] == displaced_id]
            if emp_row.empty:
                actions.append({
                    "tipo": "CONFLITO",
                    "data": str(work_date),
                    "detalhe": f"{displaced_name} removido do {shift_code}, mas não encontrado no cadastro."
                })
                continue

            role = emp_row.iloc[0]["cargo"]
            possible_shifts = shifts_df(role)["codigo"].tolist()

            reallocated = False
            for candidate_shift in possible_shifts:
                if candidate_shift == shift_code:
                    continue

                # O turno de destino precisa estar vago
                occupied = get_assignment_by_date_shift(work_date, candidate_shift)
                if not occupied.empty:
                    continue

                # Verifica restrições do funcionário
                ok, reason = ScheduleService.can_employee_take_shift_basic(displaced_id, work_date, candidate_shift)
                if not ok:
                    continue

                # Realoca
                add_assignment(work_date, candidate_shift, displaced_id, f"Realocado automaticamente após conflito no {shift_code}")
                actions.append({
                    "tipo": "REALOCADO",
                    "data": str(work_date),
                    "detalhe": f"{displaced_name} saiu do {shift_code} e foi realocado com sucesso no {candidate_shift}."
                })
                reallocated = True
                break

            if not reallocated:
                actions.append({
                    "tipo": "PENDENTE",
                    "data": str(work_date),
                    "detalhe": f"{displaced_name} foi removido do {shift_code}, mas não havia turno alternativo viável no mesmo dia."
                })

        return pd.DataFrame(actions)

    @staticmethod
    def repair_employee_rules(employee_id: int, work_date: date) -> List[Dict[str, Any]]:
        """
        Executa heurísticas corretivas de auto-repair para o próprio funcionário:
        1. Descanso de 12h: se conflita com D-1 ou D+1, converte o vizinho conflituoso em FOLGA (F).
        2. Sequência Consecutiva (>6 dias): se houver um bloco de >6 dias consecutivos de trabalho,
           converte um dia intermediário do bloco em FOLGA (F) (evitando alterar work_date).
        3. Pareamento T8:
           - Se work_date foi T8 e está isolado, tenta alocar T8 no dia vizinho (D-1 ou D+1) se viável/livre.
             Caso contrário, converte o T8 isolado em FOLGA (F).
           - Se houver dois T8s consecutivos, força ND no 3º dia.
        """
        logs = []
        employee_id = int(employee_id)
        work_date = pd.to_datetime(work_date).date()
        
        emp_df = employees_df()
        emp_match = emp_df[emp_df["id"] == employee_id]
        if emp_match.empty:
            return []
        
        emp = emp_match.iloc[0].to_dict()
        if emp.get("cargo") == "PAO FCF":
            return [] # Wildcard / Coringa não segue regras comuns de escala
        
        start_date, end_date = month_range(work_date.year, work_date.month)
        window_start = work_date - timedelta(days=15)
        window_end = work_date + timedelta(days=15)
        shift_map = build_shift_time_map()
        
        # Função auxiliar para carregar a situação atualizada do funcionário na janela ampliada
        def load_employee_schedule():
            sched = schedule_df(window_start, window_end)
            emp_sched = sched[sched["funcionario_id"] == employee_id]
            planned = {pd.to_datetime(r["data"]).date(): r["turno"] for _, r in emp_sched.iterrows()}
            
            alloc = allocations_df(window_start, window_end)
            emp_alloc = alloc[alloc["funcionario_id"] == employee_id]
            blocked = {pd.to_datetime(r["data"]).date(): r["tipo"] for _, r in emp_alloc.iterrows()}
            return planned, blocked

        planned, blocked = load_employee_schedule()

        # --------------------------------------------------------------------------
        # 1. DESCANSO DE 12 HORAS
        # --------------------------------------------------------------------------
        curr_shift = planned.get(work_date)
        if curr_shift and curr_shift in shift_map:
            curr_start, curr_end = shift_start_end_datetimes(work_date, shift_map[curr_shift]["inicio"], shift_map[curr_shift]["fim"])
            
            # Conflito com D-1
            prev_date = work_date - timedelta(days=1)
            prev_shift = planned.get(prev_date)
            if prev_shift and prev_shift in shift_map:
                prev_start, prev_end = shift_start_end_datetimes(prev_date, shift_map[prev_shift]["inicio"], shift_map[prev_shift]["fim"])
                violation = False
                if curr_start < prev_end:
                    violation = True
                else:
                    rest_hours = (curr_start - prev_end).total_seconds() / 3600
                    violation = rest_hours < 12
                    
                if violation:
                    ScheduleService.apply_visual_day_change(employee_id, prev_date, "FOLGA", "", "Reparo: Descanso de 12h")
                    planned.pop(prev_date, None)
                    blocked[prev_date] = "FOLGA"
                    logs.append({
                        "tipo": "REPARO DESCANSO 12H",
                        "data": str(prev_date),
                        "detalhe": f"Vizinho anterior convertido para FOLGA para garantir descanso de 12h antes de {curr_shift}."
                    })
                    
            # Conflito com D+1
            next_date = work_date + timedelta(days=1)
            next_shift = planned.get(next_date)
            if next_shift and next_shift in shift_map:
                next_start, next_end = shift_start_end_datetimes(next_date, shift_map[next_shift]["inicio"], shift_map[next_shift]["fim"])
                violation = False
                if next_start < curr_end:
                    violation = True
                else:
                    rest_hours = (next_start - curr_end).total_seconds() / 3600
                    violation = rest_hours < 12
                    
                if violation:
                    ScheduleService.apply_visual_day_change(employee_id, next_date, "FOLGA", "", "Reparo: Descanso de 12h")
                    planned.pop(next_date, None)
                    blocked[next_date] = "FOLGA"
                    logs.append({
                        "tipo": "REPARO DESCANSO 12H",
                        "data": str(next_date),
                        "detalhe": f"Vizinho posterior convertido para FOLGA para garantir descanso de 12h após {curr_shift}."
                    })

        # --------------------------------------------------------------------------
        # 2. DIAS CONSECUTIVOS DE TRABALHO (> 6 DIAS)
        # --------------------------------------------------------------------------
        max_iterations = 5
        while max_iterations > 0:
            planned, blocked = load_employee_schedule()
            worked_dates = set(planned.keys())
            
            # Retrocede até 6 dias no mês anterior para compor a sequência
            for i in range(1, 7):
                prev_d = start_date - timedelta(days=i)
                sched_prev = schedule_df(prev_d, prev_d)
                if not sched_prev.empty and not sched_prev[sched_prev["funcionario_id"] == employee_id].empty:
                    worked_dates.add(prev_d)
                else:
                    break
                    
            all_days = sorted(list(worked_dates))
            streaks = []
            curr_streak = []
            for i, d in enumerate(all_days):
                if i == 0:
                    curr_streak = [d]
                else:
                    if d == curr_streak[-1] + timedelta(days=1):
                        curr_streak.append(d)
                    else:
                        if len(curr_streak) > 6:
                            streaks.append(curr_streak)
                        curr_streak = [d]
            if len(curr_streak) > 6:
                streaks.append(curr_streak)
                
            if not streaks:
                break
                
            # Trata o primeiro streak violado
            streak = streaks[0]
            candidates = [d for d in streak if d >= start_date and d != work_date]
            if not candidates:
                break # Não há candidates passíveis de alteração neste mês
                
            # Escolhe o vizinho adjacente ao work_date para preservar a localidade do ajuste
            if work_date - timedelta(days=1) in candidates:
                chosen = work_date - timedelta(days=1)
            elif work_date + timedelta(days=1) in candidates:
                chosen = work_date + timedelta(days=1)
            else:
                chosen = candidates[0]
                
            ScheduleService.apply_visual_day_change(employee_id, chosen, "FOLGA", "", "Reparo: Limite de 6 dias consecutivos")
            planned.pop(chosen, None)
            blocked[chosen] = "FOLGA"
            logs.append({
                "tipo": "REPARO DIAS CONSECUTIVOS",
                "data": str(chosen),
                "detalhe": f"Dia convertido para FOLGA para quebrar a sequência de {len(streak)} dias consecutivos de trabalho."
            })
            max_iterations -= 1

        # --------------------------------------------------------------------------
        # 3. PAREAMENTO T8
        # --------------------------------------------------------------------------
        planned, blocked = load_employee_schedule()
        
        # 3a. Se work_date foi T8, garante pareamento
        if planned.get(work_date) == "T8":
            prev_t8 = planned.get(work_date - timedelta(days=1)) == "T8"
            next_t8 = planned.get(work_date + timedelta(days=1)) == "T8"
            if not prev_t8 and not next_t8:
                # T8 isolado! Tenta parear
                paired = False
                for adj_date in [work_date - timedelta(days=1), work_date + timedelta(days=1)]:
                    if adj_date in blocked:
                        continue
                    
                    # Verifica viabilidade de alocar T8 no dia adjacente
                    ok, reason = ScheduleService.can_employee_take_shift_basic(employee_id, adj_date, "T8")
                    if ok:
                        ScheduleService.apply_visual_day_change(employee_id, adj_date, "TURNO", "T8", "Reparo: Pareamento T8")
                        planned[adj_date] = "T8"
                        logs.append({
                            "tipo": "REPARO PAREAMENTO T8",
                            "data": str(adj_date),
                            "detalhe": f"Turno T8 adicionado para parear com o T8 de {work_date}."
                        })
                        paired = True
                        break
                if not paired:
                    # Se não puder parear, converte o T8 isolado em FOLGA (F)
                    ScheduleService.apply_visual_day_change(employee_id, work_date, "FOLGA", "", "Reparo: T8 isolado sem pareamento")
                    planned.pop(work_date, None)
                    blocked[work_date] = "FOLGA"
                    logs.append({
                        "tipo": "REPARO PAREAMENTO T8",
                        "data": str(work_date),
                        "detalhe": "Turno T8 convertido para FOLGA por estar isolado e sem possibilidade de pareamento."
                    })

        # 3b. Força ND no 3º dia após dois T8s consecutivos
        planned, blocked = load_employee_schedule()
        for d in sorted(list(planned.keys())):
            if planned.get(d) == "T8" and planned.get(d + timedelta(days=1)) == "T8":
                nd_day = d + timedelta(days=2)
                if nd_day <= window_end:
                    if blocked.get(nd_day) != "ND":
                        ScheduleService.apply_visual_day_change(employee_id, nd_day, "ND", "", "Reparo: ND obrigatório pós-T8")
                        planned.pop(nd_day, None)
                        blocked[nd_day] = "ND"
                        logs.append({
                            "tipo": "REPARO ND PÓS-T8",
                            "data": str(nd_day),
                            "detalhe": f"Definido como ND obrigatório pós-T8 devido a dois turnos T8 consecutivos em {d} e {d + timedelta(days=1)}."
                        })
                        
        return logs

    @staticmethod
    def apply_visual_day_change_with_repair(
        employee_id: int,
        target_date: date,
        action_type: str,
        value: str = "",
        notes: str = "Ajuste pela Escala Visual"
    ) -> pd.DataFrame:
        """Interface unificada de edição com aplicação de heurísticas corretivas em conflitos."""
        all_logs = []
        
        if action_type == "TURNO" and value:
            # Primeiro, resolve o conflito de turno entre funcionários
            logs_conflict = ScheduleService.repair_after_manual_shift(employee_id, target_date, value)
            if not logs_conflict.empty:
                all_logs.extend(logs_conflict.to_dict(orient="records"))
                
            # Segundo, resolve as violações de regras para este funcionário
            logs_rules = ScheduleService.repair_employee_rules(employee_id, target_date)
            if logs_rules:
                all_logs.extend(logs_rules)
                
            # Garante a cura de folgas agrupadas para estagiários APAO
            heal_apao_agroupada_rules(employee_id, target_date)
            # Garante a cura de folgas sociais para PAO
            heal_pao_social_rules(employee_id, target_date)
                
            return pd.DataFrame(all_logs)

        # Para pré-alocações (como FOLGA, FÉRIAS, ND, etc.)
        msg = ScheduleService.apply_visual_day_change(employee_id, target_date, action_type, value, notes)
        all_logs.append({
            "tipo": "APLICADO",
            "data": str(target_date),
            "detalhe": msg
        })
        
        # Executa auto-reparo no próprio funcionário mesmo após pré-alocações
        logs_rules = ScheduleService.repair_employee_rules(employee_id, target_date)
        if logs_rules:
            all_logs.extend(logs_rules)
            
        # Garante a cura de folgas agrupadas para estagiários APAO
        heal_apao_agroupada_rules(employee_id, target_date)
        # Garante a cura de folgas sociais para PAO
        heal_pao_social_rules(employee_id, target_date)
            
        return pd.DataFrame(all_logs)

    @staticmethod
    def apply_visual_table_edits_with_repair(original_df: pd.DataFrame, edited_df: pd.DataFrame, year: int, month: int) -> pd.DataFrame:
        """Compara as tabelas e processa alterações célula a célula."""
        changes = []
        employees = employees_df()

        if original_df is None or edited_df is None or original_df.empty or edited_df.empty:
            return pd.DataFrame(changes)

        from ui.components import is_visual_day_column, previous_month_last_day
        day_cols = [c for c in edited_df.columns if is_visual_day_column(c)]

        for idx in range(len(edited_df)):
            edited_row = edited_df.iloc[idx]
            original_row = original_df.iloc[idx]
            funcionario = edited_row.get("Funcionário")

            emp_match = employees[employees["nome"] == funcionario]
            if emp_match.empty:
                continue

            emp_id = int(emp_match.iloc[0]["id"])

            for col in day_cols:
                old_value = "" if pd.isna(original_row.get(col, "")) else str(original_row.get(col, "")).strip()
                new_value = "" if pd.isna(edited_row.get(col, "")) else str(edited_row.get(col, "")).strip()

                if old_value == new_value:
                    continue

                try:
                    # Resolve o dia considerando o índice da coluna
                    col_position = list(edited_df.columns).index(col) - 3  # ignora Cargo, Sen, Funcionário
                    target_date = date(int(year), int(month), int(str(col).strip())) if col_position > 0 else previous_month_last_day(int(year), int(month))
                except Exception:
                    continue

                action, value = ScheduleService.visual_code_to_action(new_value)
                if action is None:
                    changes.append({
                        "tipo": "IGNORADO",
                        "data": str(target_date),
                        "detalhe": f"Código não reconhecido: {new_value}"
                    })
                    continue

                result = ScheduleService.apply_visual_day_change_with_repair(emp_id, target_date, action, value, "Ajuste pela tabela interativa")
                if not result.empty:
                    for _, rr in result.iterrows():
                        changes.append(rr.to_dict())

        return pd.DataFrame(changes)

    @staticmethod
    def viability_summary_df(year: int, month: int) -> pd.DataFrame:
        """Gera o resumo estatístico de viabilidade estrutural do mês selecionado."""
        start_date, end_date = month_range(year, month)
        days = calendar.monthrange(year, month)[1]
        emp = employees_df()
        alloc = allocations_df(start_date, end_date)

        pao_count = len(emp[emp["cargo"] == "PAO"]) if not emp.empty else 0
        apao_count = len(emp[emp["cargo"] == "APAO"]) if not emp.empty else 0

        pao_required = days * 3  # Turnos T6, T7 e T8 obrigatórios por dia
        pao_blocked = 0
        apao_blocked = 0

        if not alloc.empty:
            pao_blocked = len(alloc[(alloc["cargo"] == "PAO") & (alloc["tipo"].isin(list(BLOCK_TYPES)))])
            apao_blocked = len(alloc[(alloc["cargo"] == "APAO") & (alloc["tipo"].isin(list(BLOCK_TYPES)))])

        pao_capacity = pao_count * days - pao_blocked
        apao_capacity = apao_count * days - apao_blocked

        rows = [
            {"item": "PAO cadastrados", "valor": pao_count, "observação": "Capacidade operacional disponível"},
            {"item": "APAO cadastrados", "valor": apao_count, "observação": "Necessitam de acompanhamento de PAO"},
            {"item": "Coberturas PAO obrigatórias no mês", "valor": pao_required, "observação": "T6 + T7 + T8 por dia"},
            {"item": "Capacidade bruta PAO após bloqueios", "valor": pao_capacity, "observação": "Sem considerar folgas de descanso ou T8-T8-ND"},
            {"item": "Total de Bloqueios PAO no mês", "valor": pao_blocked, "observação": "Férias, voos, simulador, licenças e ND"},
            {"item": "Capacidade bruta APAO após bloqueios", "valor": apao_capacity, "observação": "Depende da restrição individual e escala"},
        ]

        if pao_capacity < pao_required:
            rows.append({
                "item": "⚠️ ALERTA DE CAPACIDADE",
                "valor": pao_required - pao_capacity,
                "observação": "Faltam coberturas mínimas de PAO mesmo antes de aplicar descansos regulamentares!"
            })

        return pd.DataFrame(rows)

    @staticmethod
    def crosscheck_operational_gaps(year: int, month: int) -> pd.DataFrame:
        """Varre a escala gerada em busca de lacunas cruciais nos turnos de cobertura."""
        start_date, end_date = month_range(year, month)
        sched = schedule_df(start_date, end_date)
        rows = []
        required_pao = ["T6", "T7", "T8"]

        for d in iter_days(year, month):
            for sh in required_pao:
                found = pd.DataFrame()
                if not sched.empty:
                    found = sched[
                        (pd.to_datetime(sched["data"]).dt.date == d) &
                        (sched["turno"] == sh) &
                        (sched["cargo"] == "PAO")
                    ]

                if found.empty:
                    rows.append({
                        "gravidade": "ALTA",
                        "data": str(d),
                        "turno": sh,
                        "problema": "SEM COBERTURA DE PAO",
                        "detalhe": f"Nenhum piloto PAO escalado no turno obrigatório {sh} em {d}."
                    })
                elif len(found) > 1:
                    funcs = ", ".join(found["funcionario"].tolist())
                    rows.append({
                        "gravidade": "MÉDIA",
                        "data": str(d),
                        "turno": sh,
                        "problema": "SUPERPOSIÇÃO DE PAO",
                        "detalhe": f"{len(found)} PAOs escalados no mesmo turno {sh}: {funcs}."
                    })

        return pd.DataFrame(rows)

    @staticmethod
    def employee_quality_report(year: int, month: int) -> pd.DataFrame:
        """Camada 3: nota de qualidade por funcionário (blocos, folgas, quinzena, carga)."""
        start_date, end_date = month_range(year, month)
        days = list(iter_days(year, month))
        rest_kinds = {
            "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
            "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
        }

        sched = schedule_df(start_date, end_date)
        alloc = allocations_df(start_date, end_date)
        emp_df = employees_df()
        if emp_df.empty:
            return pd.DataFrame()

        target_roles = {"PAO", "APAO", "PAO FCF"}
        rows = []
        turno_counts = []

        for _, emp in emp_df.iterrows():
            role = str(emp.get("cargo", "")).upper()
            if role not in target_roles:
                continue
            eid = int(emp["id"])
            nome = emp["nome"]

            shift_days = set()
            productive_alloc_days = set()
            if not sched.empty:
                sub = sched[sched["funcionario_id"] == eid]
                for _, r in sub.iterrows():
                    shift_days.add(pd.to_datetime(r["data"]).date())
            if not alloc.empty:
                sub = alloc[(alloc["funcionario_id"] == eid) & (alloc["tipo"].isin(["VOO", "CURSO ONLINE", "SIMULADOR", "CMA"]))]
                for _, r in sub.iterrows():
                    productive_alloc_days.add(pd.to_datetime(r["data"]).date())
            turnos = len(shift_days | productive_alloc_days)
            turno_counts.append(turnos)

            rest_days = set()
            if not alloc.empty:
                sub = alloc[(alloc["funcionario_id"] == eid) & (alloc["tipo"].isin(list(rest_kinds)))]
                for _, r in sub.iterrows():
                    rest_days.add(pd.to_datetime(r["data"]).date())

            blocks_4plus = 0
            if shift_days:
                ordered = sorted(shift_days)
                block = [ordered[0]]
                for d in ordered[1:]:
                    if d == block[-1] + timedelta(days=1):
                        block.append(d)
                    else:
                        if len(block) >= 4:
                            blocks_4plus += 1
                        block = [d]
                if len(block) >= 4:
                    blocks_4plus += 1

            folgas_isoladas = 0
            for d in rest_days:
                if (d - timedelta(days=1)) not in rest_days and (d + timedelta(days=1)) not in rest_days:
                    folgas_isoladas += 1

            excecoes_bloco = 0
            if not sched.empty:
                sub = sched[sched["funcionario_id"] == eid]
                for _, r in sub.iterrows():
                    obs = str(r.get("observacao", "") or "")
                    if "Exceção bloco" in obs or "Excecao bloco" in obs or "Exceção quinzena" in obs:
                        excecoes_bloco += 1
                        continue
                    if role == "PAO":
                        d = pd.to_datetime(r["data"]).date()
                        sh = r["turno"]
                        if sh not in {"T6", "T7", "T8"}:
                            continue
                        from core.scheduler import get_block_group, _pilot_off_block_days
                        grp = get_block_group(eid, year, month)
                        if grp and d in _pilot_off_block_days(eid, year, month, include_fixed=False):
                            excecoes_bloco += 1

            rows.append({
                "funcionario": nome,
                "cargo": role,
                "turnos": turnos,
                "blocos_4plus": blocks_4plus,
                "folgas_isoladas": folgas_isoladas,
                "excecoes_quinzena": excecoes_bloco,
                "_eid": eid,
            })

        if not rows:
            return pd.DataFrame()

        avg_turnos = sum(turno_counts) / max(len(turno_counts), 1)
        for row in rows:
            nota = 100
            nota -= row["folgas_isoladas"] * 8
            nota -= row["excecoes_quinzena"] * 10
            nota += min(row["blocos_4plus"] * 6, 24)
            nota -= max(0, abs(row["turnos"] - avg_turnos) - 2) * 4
            nota = int(max(0, min(100, round(nota))))
            row["nota"] = nota
            if nota >= 85:
                row["status"] = "Excelente"
            elif nota >= 70:
                row["status"] = "Boa"
            else:
                row["status"] = "Atenção"
            del row["_eid"]

        df = pd.DataFrame(rows).sort_values(["nota", "funcionario"], ascending=[False, True])
        return df[["funcionario", "cargo", "turnos", "blocos_4plus", "folgas_isoladas", "excecoes_quinzena", "nota", "status"]]

    @staticmethod
    def fill_blank_cells_with_flights(year: int, month: int) -> pd.DataFrame:
        """Preenche de forma automática e otimizada as células de dias produtivos vagos com VOO para PAO/PAO FCF."""
        visual_df = build_visual_schedule_dataframe(year, month)
        employees = employees_df()
        changes = []

        if visual_df.empty or employees.empty:
            return pd.DataFrame(changes)

        start_date, end_date = month_range(year, month)
        from ui.components import is_visual_day_column
        day_cols = [c for c in visual_df.columns if is_visual_day_column(c)]
        roles_to_fill = ["PAO", "PAO FCF", "APAO"]
        role_df = visual_df[visual_df["Cargo"].isin(roles_to_fill)]

        for _, row in role_df.iterrows():
            emp_name = row["Funcionário"]
            emp_match = employees[employees["nome"] == emp_name]
            if emp_match.empty:
                continue

            emp_id = int(emp_match.iloc[0]["id"])
            emp_row = emp_match.iloc[0]

            from core.rules import is_employee_planning_active_month
            if not is_employee_planning_active_month(emp_id, year, month):
                continue

            # 1. Folgas já foram alocadas na fase anterior — preencher o que sobrar com VOO
            emp_allocs = allocations_df(start_date, end_date)
            if not emp_allocs.empty:
                emp_allocs = emp_allocs[emp_allocs["funcionario_id"] == emp_id]
                current_rests = len(emp_allocs[emp_allocs["tipo"].isin([
                    "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
                    "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
                ])])
            else:
                current_rests = 0

            from core.scheduler import MIN_MONTHLY_RESTS
            needed_rests = max(0, MIN_MONTHLY_RESTS - current_rests)

            # 2. Identificar todos os dias elegíveis em branco
            eligible_blank_dates = []
            for col in day_cols:
                value = str(row.get(col, "")).strip()
                if value:
                    continue

                try:
                    d = date(int(year), int(month), int(str(col).strip()))
                except Exception:
                    continue

                if not employee_can_receive_flight(emp_row, d):
                    continue
                
                eligible_blank_dates.append(d)

            # 3. Limitar o preenchimento para garantir que a cota mínima de folgas permaneça livre
            B = len(eligible_blank_dates)
            if current_rests >= MIN_MONTHLY_RESTS:
                max_flights = B
            else:
                max_flights = max(0, B - needed_rests)

            if max_flights <= 0:
                continue

            for d in eligible_blank_dates[:max_flights]:
                delete_day_assignment_for_employee(emp_id, d)
                delete_day_allocation_for_employee(emp_id, d)
                add_allocation(emp_id, d, "VOO", "Preenchimento rápido de células vazias")
                changes.append({"funcionario": emp_name, "data": str(d), "ação": "VOO"})

        # Limpar o cache do streamlit para refletir as alterações no visual grid
        import streamlit as st
        try:
            st.cache_data.clear()
        except Exception:
            pass

        return pd.DataFrame(changes)

    @staticmethod
    def allocate_rests(year: int, month: int, roles_to_generate: List[str]) -> pd.DataFrame:
        """Aloca folgas (mín. 10), folga social, blocos de descanso e voos agrupados para PAO/PAO FCF."""
        from core.scheduler import auto_allocate_rests
        import streamlit as st
        try:
            st.cache_data.clear()
        except Exception:
            pass
        return auto_allocate_rests(year, month, roles_to_generate)
