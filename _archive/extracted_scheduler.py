<file path="core/scheduler.py">
import pandas as pd
from datetime import datetime, date, timedelta

from database.connection import execute, backup_db
from database.repositories import (
    employees_df,
    shifts_df,
    allocations_df,
    shift_restrictions_df,
    schedule_df,
    add_allocation,
    add_assignment,
    build_shift_restriction_map,
)
from core.rules import (
    month_range,
    iter_days,
    has_12h_rest,
    max_simultaneous_workers_if_added,
    consecutive_work_count,
    t8_previous_count,
    shift_count_for_employee,
    total_work_for_employee,
    role_for_shift,
    apao_has_pao_companion,
    apao_has_no_other_apao_overlap,
    monthly_work_count,
    monthly_rest_count,
    build_shift_time_map,
    BLOCK_TYPES,
)

def employee_can_receive_flight(emp_row, target_date):
    """Verifica se o funcionário PAO está habilitado para receber vôo automático no período."""
    if str(emp_row.get("cargo", "")).upper() != "PAO":
        return False
    if int(emp_row.get("sem_voo", 0) or 0) != 1:
        return True
    if int(emp_row.get("sem_voo_indeterminado", 0) or 0) == 1:
        return False
    start = emp_row.get("sem_voo_inicio")
    end = emp_row.get("sem_voo_fim")
    if not start and not end:
        return False
    target = pd.to_datetime(target_date).date()
    if start and target < pd.to_datetime(start).date():
        return True
    if end and target > pd.to_datetime(end).date():
        return True
    return False

def can_work(emp, day, shift_code, blocked, planned, shift_map=None, shift_restrictions=None, max_monthly_work=None, strict=True):
    """Verifica se o funcionário pode assumir o turno na data sob os parâmetros fornecidos."""
    emp_id = int(emp["id"])
    cargo = str(emp.get("cargo", emp.get("role", ""))).strip().upper()

    if (emp_id, day) in blocked:
        block_type = str(blocked[(emp_id, day)]).strip().upper()
        if cargo == "PAO FCF" and block_type in ["SIMULADOR", "CURSO ONLINE", "VOO"]:
            pass
        else:
            return False, f"bloqueado: {blocked[(emp_id, day)]}"

    if shift_restrictions is not None:
        restricted = shift_restrictions.get(emp_id, set())
        if str(shift_code).upper() in restricted:
            return False, f"turno {shift_code} bloqueado para o funcionário neste mês"

    if max_monthly_work is not None:
        current_work = monthly_work_count(emp_id, planned)
        if cargo == "PAO FCF":
            extra_count = sum(
                1 for (eid, d), kind in blocked.items()
                if int(eid) == emp_id and str(kind).upper() in ["SIMULADOR", "CURSO ONLINE", "VOO"]
            )
            current_work += extra_count
        if current_work >= int(max_monthly_work):
            return False, f"limite mensal de {max_monthly_work} turnos atingido"

    if planned.get((emp_id, day)):
        return False, "já alocado no dia"

    if shift_map is not None:
        if shift_code in shift_map and shift_map[shift_code].get("no_fds", 0) == 1:
            if day.weekday() >= 5:
                return False, f"turno {shift_code} não pode ser alocado em fins de semana"

        rest_result = has_12h_rest(emp_id, day, shift_code, planned, shift_map)
        if not rest_result:
            return False, "erro interno na validação de descanso"
        ok_rest, rest_reason = rest_result
        if not ok_rest:
            return False, rest_reason

        if max_simultaneous_workers_if_added(emp_id, day, shift_code, planned, shift_map) > 2:
            return False, "limite físico de 2 estações simultâneas"

        if role_for_shift(shift_code, shift_map) == "APAO" and cargo.startswith("APAO"):
            if not apao_has_pao_companion(day, shift_code, planned, shift_map):
                return False, "APAO precisa estar acompanhado por PAO durante todo o turno"
            if not apao_has_no_other_apao_overlap(emp_id, day, shift_code, planned, shift_map):
                return False, "dois APAOs simultâneos não permitido"

    if shift_map is not None and role_for_shift(shift_code, shift_map) == "APAO" and cargo.startswith("APAO"):
        if consecutive_work_count(emp_id, day, planned) >= 6:
            return False, "APAO precisa folgar após 6 dias consecutivos"

    if cargo != "PAO FCF":
        if strict and consecutive_work_count(emp_id, day, planned) >= 6:
            return False, "mais de 6 dias consecutivos"

        if shift_code == "T8" and t8_previous_count(emp_id, day, planned) >= 2:
            return False, "T8 após 2 dias consecutivos"

    if int(emp.get("fixo", 0)) == 1:
        fixed = emp.get("turno_fixo")
        if fixed and fixed != shift_code:
            return False, f"funcionário fixo no {fixed}"

    return True, ""

def employee_score(emp, day, shift_code, planned):
    """Calcula a penalidade operacional de um piloto para o turno; menor pontuação ganha prioridade."""
    emp_id = int(emp["id"])
    score = 0

    total_work = total_work_for_employee(emp_id, planned)
    previous_streak = consecutive_work_count(emp_id, day, planned)

    score += total_work * 10
    score += shift_count_for_employee(emp_id, shift_code, planned) * 5

    if previous_streak in [1, 2]:
        score -= 35
    elif previous_streak == 0:
        score += 8

    score += max(previous_streak - 3, 0) * 4

    role = str(emp.get("cargo", emp.get("role", ""))).upper()
    if role == "APAO":
        score += float(emp["senioridade"]) * 0.03
    else:
        score += float(emp["senioridade"]) * 0.1

    if int(emp.get("fixo", 0)) == 1 and emp.get("turno_fixo") == shift_code:
        score -= 50

    return score

def existing_alloc_set(start_date, end_date):
    """Retorna o conjunto (funcionario_id, data) de alocações que já estão gravadas no banco."""
    alloc = allocations_df(start_date, end_date)
    existing = set()
    if not alloc.empty:
        for _, r in alloc.iterrows():
            existing.add((int(r["funcionario_id"]), pd.to_datetime(r["data"]).date()))
    return existing

def auto_add_monthly_rest_allocations(year, month, roles_to_generate):
    """Lança automaticamente Folga Social (PAO) e Folga Agrupada (APAO) preservando as restrições."""
    start_date, end_date = month_range(year, month)

    placeholders = ",".join(["?"] * len(roles_to_generate)) if roles_to_generate else "?"
    params = [str(start_date), str(end_date)] + (roles_to_generate if roles_to_generate else ["__NONE__"])
    execute(f"""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND notes = 'Gerado automaticamente'
        AND employee_id IN (
            SELECT id FROM employees WHERE role IN ({placeholders})
        )
        AND alloc_type IN ('FOLGA SOCIAL', 'FOLGA AGRUPADA')
    """, tuple(params))

    existing = existing_alloc_set(start_date, end_date)
    created = []

    valid_pao_pairs = []
    valid_apao_pairs = []

    for d in iter_days(year, month):
        if d.weekday() == 5 and d + timedelta(days=1) <= end_date:
            valid_pao_pairs.append((d, d + timedelta(days=1)))
            valid_apao_pairs.append((d, d + timedelta(days=1)))

        if d.weekday() == 6 and d + timedelta(days=1) <= end_date:
            valid_apao_pairs.append((d, d + timedelta(days=1)))

    apao_rest_days_used = set()

    for role in roles_to_generate:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue

        for idx, emp in enumerate(emp_df.to_dict("records")):
            emp_id = int(emp["id"])

            if role == "PAO":
                if not valid_pao_pairs:
                    continue
                candidate_pairs = valid_pao_pairs
                tipo = "FOLGA SOCIAL"

                chosen_pair = None
                for offset in range(len(candidate_pairs)):
                    test_pair = candidate_pairs[(idx + offset) % len(candidate_pairs)]
                    if all((emp_id, day) not in existing for day in test_pair):
                        chosen_pair = test_pair
                        break

            elif role == "APAO":
                if not valid_apao_pairs:
                    continue
                candidate_pairs = valid_apao_pairs
                tipo = "FOLGA AGRUPADA"

                chosen_pair = None
                for offset in range(len(candidate_pairs)):
                    test_pair = candidate_pairs[(idx + offset) % len(candidate_pairs)]

                    if any((emp_id, day) in existing for day in test_pair):
                        continue
                    if any(day in apao_rest_days_used for day in test_pair):
                        continue

                    chosen_pair = test_pair
                    break
            else:
                continue

            if chosen_pair is None:
                continue

            for day in chosen_pair:
                add_allocation(emp_id, day, tipo, "Gerado automaticamente")
                existing.add((emp_id, day))
                if role == "APAO":
                    apao_rest_days_used.add(day)

                created.append({
                    "funcionario": emp["nome"],
                    "cargo": role,
                    "data": str(day),
                    "tipo": tipo
                })

    return pd.DataFrame(created)

def create_t8_pairs_with_nd(year, month, employees, blocked, planned, shift_map, shift_restrictions=None, max_monthly_work=None):
    """Cobre o turno T8 alocando blocos de T8, T8, ND e atualizando a matriz planejada."""
    if "T8" not in shift_map:
        return [], []

    days = list(iter_days(year, month))
    created = []
    log = []

    for i, day1 in enumerate(days):
        if any(d == day1 and sh == "T8" for (_eid, d), sh in planned.items()):
            continue

        if i + 1 >= len(days):
            log.append({
                "tipo": "T8 NÃO GERADO",
                "data": str(day1),
                "cargo": "PAO",
                "turno": "T8",
                "detalhe": "Último dia do mês sem dia seguinte para formar bloco T8,T8,ND."
            })
            continue

        day2 = days[i + 1]
        day3 = days[i + 2] if i + 2 < len(days) else None

        candidates = []
        for emp in employees:
            emp_id = int(emp["id"])

            ok1, _ = can_work(
                emp, day1, "T8", blocked, planned,
                shift_map=shift_map,
                shift_restrictions=shift_restrictions,
                max_monthly_work=max_monthly_work,
                strict=True
            )
            if not ok1:
                continue

            temp_planned = dict(planned)
            temp_planned[(emp_id, day1)] = "T8"

            ok2, _ = can_work(
                emp, day2, "T8", blocked, temp_planned,
                shift_map=shift_map,
                shift_restrictions=shift_restrictions,
                max_monthly_work=max_monthly_work,
                strict=True
            )
            if not ok2:
                continue

            if day3 is not None:
                if (emp_id, day3) in blocked:
                    continue
                if temp_planned.get((emp_id, day3)):
                    continue

            candidates.append((employee_score(emp, day1, "T8", planned), emp))

        if not candidates:
            log.append({
                "tipo": "T8 SEM COBERTURA",
                "data": str(day1),
                "cargo": "PAO",
                "turno": "T8",
                "detalhe": "Não foi encontrado PAO disponível para iniciar bloco T8,T8,ND neste dia."
            })
            continue

        candidates.sort(key=lambda x: x[0])
        chosen = candidates[0][1]
        emp_id = int(chosen["id"])

        if not planned.get((emp_id, day1)):
            planned[(emp_id, day1)] = "T8"
            created.append((str(day1), "T8", emp_id, "Bloco automático T8 1/2"))

        if not planned.get((emp_id, day2)):
            planned[(emp_id, day2)] = "T8"
            created.append((str(day2), "T8", emp_id, "Bloco automático T8 2/2"))

        if day3 is not None:
            blocked[(emp_id, day3)] = "ND"
            add_allocation(emp_id, day3, "ND", "Gerado automaticamente após 2 T8")

        log.append({
            "tipo": "T8 BLOCO",
            "data": f"{day1} / {day2}" + (f" / {day3}" if day3 else ""),
            "cargo": "PAO",
            "turno": "T8",
            "detalhe": f"{chosen['nome']}: T8,T8" + (",ND." if day3 else ".")
        })

    return created, log

def auto_add_apao_6x1_rest(year, month, blocked):
    """Calcula e lança folgas automáticas no formato 6x1 para os estagiários APAO."""
    start_date, end_date = month_range(year, month)

    execute("""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND alloc_type = 'FOLGA'
        AND notes = 'Gerado automaticamente 6x1 APAO'
        AND employee_id IN (SELECT id FROM employees WHERE role = 'APAO')
    """, (str(start_date), str(end_date)))

    emp_df = employees_df("APAO")
    created = []

    if emp_df.empty:
        return pd.DataFrame(created)

    apao_ids = set(int(x) for x in emp_df["id"].tolist())
    blocking_types = {
        "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA",
        "FÉRIAS", "DISPENSA MÉDICA", "CURSO ONLINE", "SIMULADOR", "VOO", "ND"
    }

    blocked_by_day = {}
    for (eid, d), kind in blocked.items():
        if int(eid) in apao_ids and kind in blocking_types:
            blocked_by_day[d] = blocked_by_day.get(d, 0) + 1

    for _, emp in emp_df.iterrows():
        emp_id = int(emp["id"])
        offset = (int(emp["senioridade"]) - 1) % 7

        day_index = 0
        for d in iter_days(year, month):
            position = (day_index + offset) % 7

            if position == 6:
                chosen = None
                candidates = [d, d + timedelta(days=1), d - timedelta(days=1), d + timedelta(days=2), d - timedelta(days=2)]
                for candidate in candidates:
                    if not (start_date <= candidate <= end_date):
                        continue
                    if (emp_id, candidate) in blocked:
                        continue

                    # Garante que não deixa todos os APAOs indisponíveis
                    if blocked_by_day.get(candidate, 0) >= 1:
                        continue

                    chosen = candidate
                    break

                if chosen is not None:
                    add_allocation(emp_id, chosen, "FOLGA", "Gerado automaticamente 6x1 APAO")
                    blocked[(emp_id, chosen)] = "FOLGA"
                    blocked_by_day[chosen] = blocked_by_day.get(chosen, 0) + 1
                    created.append({
                        "funcionario": emp["nome"],
                        "cargo": "APAO",
                        "data": str(chosen),
                        "tipo": "FOLGA 6x1"
                    })

            day_index += 1

    return pd.DataFrame(created)

def auto_add_pao_flights(year, month, roles_to_generate, blocked):
    """Aloca um vôo de preferência de pontuação operacional por piloto PAO habilitado no mês."""
    if "PAO" not in roles_to_generate:
        return pd.DataFrame()

    start_date, end_date = month_range(year, month)

    execute("""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND alloc_type = 'VOO'
        AND notes = 'Gerado automaticamente para PAO'
    """, (str(start_date), str(end_date)))

    alloc = allocations_df(start_date, end_date)
    blocked.clear()
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    emp_df = employees_df("PAO")
    created = []
    if emp_df.empty:
        return pd.DataFrame(created)

    for _, emp in emp_df.iterrows():
        if not employee_can_receive_flight(emp, start_date):
            continue

        emp_id = int(emp["id"])
        candidates = []
        for d in iter_days(year, month):
            if (emp_id, d) in blocked:
                continue
            before = blocked.get((emp_id, d - timedelta(days=1)))
            after = blocked.get((emp_id, d + timedelta(days=1)))
            score = 0
            if before in ["FOLGA", "FOLGA PEDIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA"]:
                score -= 10
            if after in ["FOLGA", "FOLGA PEDIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA"]:
                score -= 10
            if d.weekday() >= 5:
                score += 3
            candidates.append((score, d))

        if not candidates:
            continue

        candidates.sort(key=lambda x: x[0])
        chosen_day = candidates[0][1]
        add_allocation(emp_id, chosen_day, "VOO", "Gerado automaticamente para PAO")
        blocked[(emp_id, chosen_day)] = "VOO"
        created.append({"funcionario": emp["nome"], "data": str(chosen_day), "tipo": "VOO"})

    return pd.DataFrame(created)

def auto_add_target_rests(year, month, roles_to_generate, blocked, target_rests):
    """Completa as folgas do funcionário até atingir a quantidade desejada de folgas no mês."""
    if target_rests is None:
        if "PAO FCF" not in roles_to_generate:
            return pd.DataFrame()

    start_date, end_date = month_range(year, month)

    placeholders = ",".join(["?"] * len(roles_to_generate)) if roles_to_generate else "?"
    params = [str(start_date), str(end_date)] + (roles_to_generate if roles_to_generate else ["__NONE__"])
    execute(f"""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND alloc_type = 'FOLGA'
        AND notes = 'Gerado automaticamente por meta de folgas'
        AND employee_id IN (
            SELECT id FROM employees WHERE role IN ({placeholders})
        )
    """, tuple(params))

    alloc = allocations_df(start_date, end_date)
    blocked.clear()
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    created = []
    emp_df = employees_df()

    for _, emp in emp_df.iterrows():
        if emp["cargo"] not in roles_to_generate:
            continue

        emp_id = int(emp["id"])
        emp_cargo = str(emp.get("cargo", "")).strip().upper()
        if emp_cargo == "PAO FCF":
            actual_target = 10
        else:
            actual_target = int(target_rests) if target_rests is not None else 0

        if actual_target <= 0:
            continue

        current_rests = monthly_rest_count(emp_id, blocked)
        needed = max(0, actual_target - current_rests)

        if needed <= 0:
            continue

        candidate_days = list(iter_days(year, month))
        idx = 0
        while needed > 0 and idx < len(candidate_days):
            d = candidate_days[idx]

            if (emp_id, d) in blocked:
                idx += 1
                continue

            d2 = d + timedelta(days=1)
            if needed >= 2 and d2 <= end_date and (emp_id, d2) not in blocked:
                add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                add_allocation(emp_id, d2, "FOLGA", "Gerado automaticamente por meta de folgas")
                blocked[(emp_id, d)] = "FOLGA"
                blocked[(emp_id, d2)] = "FOLGA"
                created.append({"funcionario": emp["nome"], "data": str(d), "tipo": "FOLGA"})
                created.append({"funcionario": emp["nome"], "data": str(d2), "tipo": "FOLGA"})
                needed -= 2
                idx += 2
                continue

            add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
            blocked[(emp_id, d)] = "FOLGA"
            created.append({"funcionario": emp["nome"], "data": str(d), "tipo": "FOLGA"})
            needed -= 1
            idx += 1

    return pd.DataFrame(created)

def generate_auto_schedule(year, month, roles_to_generate, clear_existing=True, strict=True, max_monthly_work=None, target_rests=None):
    """Motor de escala automática. Realiza a alocação de turnos conforme pesos e critérios operacionais."""
    start_date, end_date = month_range(year, month)

    auto_add_monthly_rest_allocations(year, month, roles_to_generate)

    if clear_existing:
        backup_db("antes_gerar_escala")
        placeholders = ",".join(["?"] * len(roles_to_generate))
        execute(f"""
            DELETE FROM assignments
            WHERE work_date BETWEEN ? AND ?
            AND employee_id IN (
                SELECT id FROM employees WHERE role IN ({placeholders})
            )
        """, tuple([str(start_date), str(end_date)] + roles_to_generate))

        execute(f"""
            DELETE FROM allocations
            WHERE alloc_date BETWEEN ? AND ?
            AND alloc_type = 'ND'
            AND notes LIKE 'Gerado automaticamente%'
            AND employee_id IN (
                SELECT id FROM employees WHERE role IN ({placeholders})
            )
        """, tuple([str(start_date), str(end_date)] + roles_to_generate))

    prev_day = start_date - timedelta(days=1)
    all_existing = schedule_df(prev_day, end_date)
    planned = {}
    if not all_existing.empty:
        for _, r in all_existing.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    alloc = allocations_df(prev_day, end_date)
    blocked = {}
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    shift_map = build_shift_time_map()
    shift_restrictions = build_shift_restriction_map(year, month)

    if "APAO" in roles_to_generate:
        auto_add_apao_6x1_rest(year, month, blocked)
        alloc = allocations_df(start_date, end_date)
        blocked = {}
        if not alloc.empty:
            for _, r in alloc.iterrows():
                blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    log = []
    created = []

    for role in roles_to_generate:
        emp_df = employees_df(role)
        if role == "PAO FCF":
            if emp_df.empty:
                continue
            # Enforce exactly 10 rests for PAO FCF
            auto_add_target_rests(year, month, [role], blocked, target_rests=10)
            # Update blocked
            alloc = allocations_df(start_date, end_date)
            blocked = {}
            if not alloc.empty:
                for _, r in alloc.iterrows():
                    blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

            employees = emp_df.to_dict("records")
            for emp in employees:
                emp_id = int(emp["id"])
                extra_count = sum(
                    1 for (eid, d), kind in blocked.items()
                    if int(eid) == emp_id and str(kind).upper() in ["SIMULADOR", "CURSO ONLINE", "VOO"]
                )
                current_worked = sum(1 for (eid, d), sh in planned.items() if int(eid) == emp_id and sh) + extra_count
                
                # Determine preference shift (fixed_shift or T9)
                pref_shift = emp.get("turno_fixo") or "T9"
                if pref_shift not in shift_map:
                    pao_sh = shifts_df("PAO")
                    if not pao_sh.empty:
                        pref_shift = pao_sh.iloc[0]["codigo"]
                    else:
                        all_sh = shifts_df()
                        if not all_sh.empty:
                            pref_shift = all_sh.iloc[0]["codigo"]
                        else:
                            pref_shift = "T9"

                for d in iter_days(year, month):
                    if current_worked >= 20:
                        break
                    ok, reason = can_work(emp, d, pref_shift, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, max_monthly_work=None, strict=False)
                    if ok:
                        planned[(emp_id, d)] = pref_shift
                        created.append((str(d), pref_shift, emp_id, "Gerado automaticamente (Coringa FCF)"))
                        current_worked += 1
                        log.append({
                            "tipo": "ALOCADO",
                            "data": str(d),
                            "cargo": role,
                            "turno": pref_shift,
                            "detalhe": f"{emp['nome']} alocado no {pref_shift} (Coringa)."
                        })
            continue

        sh_df = shifts_df(role)

        if emp_df.empty:
            log.append({"tipo": "ERRO", "data": "-", "cargo": role, "turno": "-", "detalhe": f"Não há funcionários cadastrados para {role}."})
            continue

        if sh_df.empty:
            log.append({"tipo": "ERRO", "data": "-", "cargo": role, "turno": "-", "detalhe": f"Não há turnos cadastrados para {role}."})
            continue

        employees = emp_df.to_dict("records")
        shifts = sh_df.to_dict("records")

        if role == "PAO":
            t8_created, t8_log = create_t8_pairs_with_nd(year, month, employees, blocked, planned, shift_map, shift_restrictions=shift_restrictions, max_monthly_work=max_monthly_work)
            created.extend(t8_created)
            log.extend(t8_log)
            shifts = [s for s in shifts if s["codigo"] != "T8"]

        for day in iter_days(year, month):
            for shift in shifts:
                shift_code = shift["codigo"]
                need = int(shift["maximo"])
                already_count = sum(1 for (eid, d), sh in planned.items() if d == day and sh == shift_code)
                slots = max(0, need - already_count)

                for _ in range(slots):
                    candidates = []
                    for emp in employees:
                        ok, reason = can_work(emp, day, shift_code, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, max_monthly_work=max_monthly_work, strict=strict)
                        if ok:
                            candidates.append((employee_score(emp, day, shift_code, planned), emp))

                    if not candidates and strict:
                        for emp in employees:
                            ok, reason = can_work(emp, day, shift_code, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, max_monthly_work=max_monthly_work, strict=False)
                            if ok:
                                if shift_code == "T8" and t8_previous_count(int(emp["id"]), day, planned) >= 2:
                                    continue
                                if role_for_shift(shift_code, shift_map) == "APAO" and consecutive_work_count(int(emp["id"]), day, planned) >= 6:
                                    continue
                                candidates.append((employee_score(emp, day, shift_code, planned) + 1000, emp))

                    if not candidates and role == "APAO":
                        # Heurística de Fallback: Cobertura de turno de APAO por PAO
                        pao_employees = employees_df("PAO").to_dict("records")
                        for emp in pao_employees:
                            ok, reason = can_work(emp, day, shift_code, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, max_monthly_work=max_monthly_work, strict=True)
                            if ok:
                                candidates.append((employee_score(emp, day, shift_code, planned), emp))
                        if not candidates:
                            for emp in pao_employees:
                                ok, reason = can_work(emp, day, shift_code, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, max_monthly_work=max_monthly_work, strict=False)
                                if ok:
                                    candidates.append((employee_score(emp, day, shift_code, planned) + 1000, emp))

                    if not candidates:
                        log.append({"tipo": "SEM COBERTURA", "data": str(day), "cargo": role, "turno": shift_code, "detalhe": "Não foi encontrado funcionário disponível sem violar bloqueios/regras fortes."})
                        continue

                    candidates.sort(key=lambda x: x[0])
                    chosen = candidates[0][1]
                    emp_id = int(chosen["id"])
                    planned[(emp_id, day)] = shift_code
                    
                    is_fallback = str(chosen.get("cargo", chosen.get("role", ""))).upper().startswith("PAO")
                    note = "Gerado automaticamente (Fallback PAO em turno APAO)" if is_fallback else "Gerado automaticamente"
                    created.append((str(day), shift_code, emp_id, note))
                    
                    detalhe = f"{chosen['nome']} alocado no {shift_code} (Fallback Cobertura APAO)." if is_fallback else f"{chosen['nome']} alocado no {shift_code}."
                    log.append({"tipo": "ALOCADO", "data": str(day), "cargo": role, "turno": shift_code, "detalhe": detalhe})

    for work_date, shift_code, emp_id, notes in created:
        add_assignment(work_date, shift_code, emp_id, notes)

    # Regra 4: Executar cura de Folga Agrupada para todos os estagiários APAO ao final da geração
    if "APAO" in roles_to_generate:
        apao_df = employees_df("APAO")
        if not apao_df.empty:
            from database.repositories import heal_apao_agroupada_rules
            for _, emp in apao_df.iterrows():
                heal_apao_agroupada_rules(int(emp["id"]), (year, month))

    # Executar cura de Folga Social para funcionários PAO / PAO FCF
    all_emp = employees_df()
    if not all_emp.empty:
        from database.repositories import heal_pao_social_rules
        for _, emp in all_emp.iterrows():
            emp_cargo = str(emp.get("cargo", "")).strip().upper()
            if emp_cargo in ["PAO", "PAO FCF"]:
                heal_pao_social_rules(int(emp["id"]), (year, month))

    return pd.DataFrame(log)
</file>