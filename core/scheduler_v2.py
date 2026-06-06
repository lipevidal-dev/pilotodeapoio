"""
Motor unificado v2 — cobertura 100% primeiro, depois VOO/folgas agrupadas.

Camadas:
  1. Inviolável: 6x1 carryover, pré-alocações, cobertura T6/T7/T8 diária e mensal
  2. Pós-cobertura: folgas 10–11 (máx. 12) → VOO no restante
  3. Meta: ~20 turnos (soft)
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import pandas as pd

from database.connection import backup_db
from core.rules import month_range, iter_days, vacation_employee_ids_by_day, is_employee_planning_active_month, employee_vacation_dates
from database.repositories import employees_df, allocations_df, schedule_df
from core.scheduler import (
    generate_auto_schedule,
    _enforce_mandatory_6x1_rests,
    _enforce_exact_ten_rests,
    force_close_pao_coverage,
    enforce_t8_t8_nd_month,
    fill_schedule_blank_cells,
    count_visual_blank_cells,
    get_fortnight_group,
)
from core.coverage_gate import (
    enforce_full_coverage,
    allocate_post_coverage_rests,
    audit_generation,
    count_pao_coverage_gaps,
)
from core.spreadsheet_validator import coverage_health, daily_summary_row, list_spreadsheet_gaps

HARD_BLOCKS = {
    "FÉRIAS", "FERIAS", "CURSO ONLINE", "FOLGA PEDIDA",
    "DISPENSA MÉDICA", "SIMULADOR", "ND", "VOO", "CMA",
}
REST_TYPES = {
    "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
    "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO", "FÉRIAS",
}
PAO_SHIFTS_PER_DAY = 3  # T6 + T7 + T8
DAYS_PER_MONTH = 30


def compute_day_difficulty_order(year: int, month: int) -> List[date]:
    """Dias mais difíceis primeiro (muitos bloqueios PAO, fim de semana)."""
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    pao_df = employees_df("PAO")
    pao_ids = set(pao_df["id"].astype(int).tolist()) if not pao_df.empty else set()

    blocked_by_day: Dict[date, int] = {}
    if not alloc.empty:
        for _, r in alloc.iterrows():
            eid = int(r["funcionario_id"])
            if eid not in pao_ids:
                continue
            d = pd.to_datetime(r["data"]).date()
            tipo = str(r["tipo"]).upper()
            if tipo in HARD_BLOCKS or tipo in REST_TYPES:
                blocked_by_day[d] = blocked_by_day.get(d, 0) + 1

    def difficulty(d: date) -> float:
        score = blocked_by_day.get(d, 0) * 10.0
        if d.weekday() >= 5:
            score += 3.0
        if d.day <= 5 or d.day >= 25:
            score += 1.0
        return score

    days = list(iter_days(year, month))
    return sorted(days, key=difficulty, reverse=True)


def diagnose_capacity(year: int, month: int) -> Dict[str, Any]:
    """
    Mede se o mês é viável antes de gerar.
    Retorna status: ok | atencao | critico
    """
    start_date, end_date = month_range(year, month)
    days = list(iter_days(year, month))
    n_days = len(days)

    pao_df = employees_df("PAO")
    if pao_df.empty:
        return {
            "status": "critico",
            "status_label": "CRÍTICO",
            "message": "Nenhum piloto PAO cadastrado.",
            "pao_pilotos": 0,
            "pao_slots_necessarios": n_days * PAO_SHIFTS_PER_DAY,
            "pao_capacidade_turnos": 0,
            "deficit_turnos": n_days * PAO_SHIFTS_PER_DAY,
            "blockers": [],
            "summary_rows": [],
        }

    alloc = allocations_df(start_date, end_date)
    pao_ids = pao_df["id"].astype(int).tolist()
    vacation_by_day = vacation_employee_ids_by_day(year, month)

    pilot_stats = []
    total_available = 0
    for _, emp in pao_df.iterrows():
        eid = int(emp["id"])
        nome = emp["nome"]
        if not is_employee_planning_active_month(eid, year, month):
            vac_n = len(employee_vacation_dates(eid, year, month))
            pilot_stats.append({
                "piloto": nome,
                "dias_bloqueados": vac_n,
                "tipo": "férias — fora do planejamento",
            })
            continue
        blocked_days = set()
        if not alloc.empty:
            sub = alloc[(alloc["funcionario_id"] == eid)]
            for _, r in sub.iterrows():
                d = pd.to_datetime(r["data"]).date()
                tipo = str(r["tipo"]).upper()
                if tipo in HARD_BLOCKS or tipo in REST_TYPES:
                    blocked_days.add(d)
        avail = n_days - len(blocked_days)
        total_available += avail
        if len(blocked_days) >= 20:
            pilot_stats.append({
                "piloto": nome,
                "dias_bloqueados": len(blocked_days),
                "tipo": "muitos bloqueios",
            })

    slots_needed = n_days * PAO_SHIFTS_PER_DAY
    realistic_cap = 0
    for _, emp in pao_df.iterrows():
        eid = int(emp["id"])
        if not is_employee_planning_active_month(eid, year, month):
            continue
        blocked_count = 0
        if not alloc.empty:
            sub = alloc[alloc["funcionario_id"] == eid]
            for _, r in sub.iterrows():
                if str(r["tipo"]).upper() in HARD_BLOCKS | REST_TYPES:
                    blocked_count += 1
        realistic_cap += min(20, max(0, n_days - blocked_count))

    deficit = max(0, slots_needed - total_available)
    ratio = total_available / slots_needed if slots_needed else 1.0

    if ratio < 0.85 or deficit > 15:
        status, label = "critico", "CRÍTICO"
        msg = (
            f"Capacidade insuficiente: faltam ~{deficit} dia(s)-piloto para cobrir "
            f"{slots_needed} turnos PAO. Revise férias/folgas pedidas ou reforce a equipe."
        )
    elif ratio < 0.95 or deficit > 5:
        status, label = "atencao", "ATENÇÃO"
        msg = (
            f"Mês apertado ({int(ratio * 100)}% da capacidade bruta). "
            "A escala pode ter furos — blocos serão flexibilizados."
        )
    else:
        status, label = "ok", "OK"
        msg = "Capacidade adequada para gerar a escala."

    summary_rows = [
        {"item": "Pilotos PAO ativos", "valor": len(pao_ids), "observação": ""},
        {"item": "Turnos PAO necessários (T6+T7+T8 × dias)", "valor": slots_needed, "observação": f"{n_days} dias"},
        {"item": "Dias-piloto disponíveis (bruto)", "valor": total_available, "observação": "Após bloqueios L/K/FP/folgas"},
        {"item": "Capacidade realista (~20T/piloto)", "valor": realistic_cap, "observação": "Estimativa"},
        {"item": "Déficit estimado", "valor": deficit, "observação": label},
    ]
    for ps in pilot_stats[:5]:
        summary_rows.append({
            "item": f"⚠ {ps['piloto']}",
            "valor": ps["dias_bloqueados"],
            "observação": ps["tipo"],
        })

    return {
        "status": status,
        "status_label": label,
        "message": msg,
        "pao_pilotos": len(pao_ids),
        "pao_slots_necessarios": slots_needed,
        "pao_capacidade_turnos": total_available,
        "deficit_turnos": deficit,
        "ratio": ratio,
        "blockers": pilot_stats,
        "summary_rows": summary_rows,
    }


def generate_unified_schedule(
    year: int,
    month: int,
    roles_to_generate: List[str],
    clear_existing: bool = True,
    auto_loop: bool = True,
    max_attempts: int = 8,
) -> pd.DataFrame:
    """
    Pipeline v2:
      1. 6x1 carryover (5 dias mês anterior)
      2. Turnos only (shifts_only)
      3. Gate cobertura 100% T6/T7/T8
      4. Só se OK: folgas (10–11) → VOO
      5. Auditoria automática
    """
    backup_db("antes_gerar_unificado_v2")
    diag = diagnose_capacity(year, month)
    log: List[Dict[str, str]] = []

    log.append({
        "tipo": f"CAPACIDADE {diag['status_label']}",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": diag["message"],
    })

    day_order = compute_day_difficulty_order(year, month)

    pre_health = coverage_health(year, month)
    log.append({
        "tipo": "PLANILHA PRE",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": pre_health["message"],
    })

    # 1) Turnos apenas (sem VOO/folgas agrupadas no início)
    gen_log = generate_auto_schedule(
        year, month, roles_to_generate,
        clear_existing=clear_existing,
        strict=False,
        day_order=day_order,
        shifts_only=True,
    )
    if not gen_log.empty:
        log.extend(gen_log.to_dict("records"))

    # 2) Gate inviolável: 100% cobertura diária/mensal
    gate = enforce_full_coverage(
        year, month, log, day_order=day_order, max_attempts=max_attempts,
    )

    coverage_ok = gate.get("ok", False)

    # 3) Pós-cobertura: folgas, VOO, blocos — só se cobertura OK
    if coverage_ok:
        allocate_post_coverage_rests(year, month, roles_to_generate, log)

        attempt = 0
        gaps = count_pao_coverage_gaps(year, month)
        while auto_loop and gaps > 0 and attempt < max_attempts:
            attempt += 1
            log.append({
                "tipo": "AUTO AJUSTE PÓS-FOLGA",
                "data": "-",
                "cargo": "PAO",
                "turno": "-",
                "detalhe": f"Tentativa {attempt}: {gaps} furo(s) PAO após folgas — fechando...",
            })
            close_result = force_close_pao_coverage(year, month, day_order=day_order)
            if close_result.get("log"):
                log.extend(close_result["log"])
            enforce_t8_t8_nd_month(year, month, log=log)
            close2 = force_close_pao_coverage(year, month, day_order=day_order)
            if close2.get("log"):
                log.extend(close2["log"])
            gaps = count_pao_coverage_gaps(year, month)

        blanks = count_visual_blank_cells(year, month)
        blank_attempt = 0
        while auto_loop and blanks > 0 and blank_attempt < 3:
            blank_attempt += 1
            fill_schedule_blank_cells(year, month, log=log)
            if gaps > 0:
                force_close_pao_coverage(year, month, day_order=day_order)
                gaps = count_pao_coverage_gaps(year, month)
            blanks = count_visual_blank_cells(year, month)
    else:
        log.append({
            "tipo": "FASE PÓS-COBERTURA BLOQUEADA",
            "data": "-",
            "cargo": "-",
            "turno": "-",
            "detalhe": "Cobertura incompleta — VOO/folgas agrupadas não alocados.",
        })

    exact = 0
    enforced = 0

    # 4) Auditoria automática
    audit = audit_generation(year, month)
    if audit["critical"]:
        log.append({
            "tipo": "AUDITORIA FALHA",
            "data": "-",
            "cargo": "-",
            "turno": "-",
            "detalhe": "; ".join(audit["critical"]),
        })
    else:
        warn = ""
        if audit.get("warnings"):
            warn = f" Avisos: {'; '.join(audit['warnings'])}."
        log.append({
            "tipo": "AUDITORIA OK",
            "data": "-",
            "cargo": "-",
            "turno": "-",
            "detalhe": (
                f"Cobertura PAO T6/T7/T8: 100%. Células vazias: {audit['blanks']}. "
                f"Violações ALTA+: {audit['violations_alta']}."
                + warn
            ),
        })

    gaps = audit["pao_gaps"]
    blanks_final = audit["blanks"]
    post_health = audit["health"]

    log.append({
        "tipo": "PLANILHA POS",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": post_health.get("message", ""),
    })

    log.append({
        "tipo": "RESUMO FINAL",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": (
            f"Capacidade: {diag['status_label']}. "
            f"Gate cobertura: {'100%' if coverage_ok else 'INCOMPLETA'}. "
            f"Furos PAO (T6/T7/T8): {gaps}. "
            f"Células vazias: {blanks_final}. "
            f"Planilha: {post_health.get('message', '')} "
            f"Modo: v2 (6x1 → turnos → cobertura 100% → folgas 10–11 → VOO)."
            + (f" Folgas exatas: {exact} ajuste(s)." if exact else "")
        ),
    })

    return pd.DataFrame(log)
