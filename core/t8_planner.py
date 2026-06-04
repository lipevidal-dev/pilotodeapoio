"""
Motor único de T8 — cobertura diária automática via blocos T8/T8/ND.

Respeita apenas pré-alocações fixas (FP, FER, C, CMA, simulador, etc.).
"""
from __future__ import annotations

from datetime import timedelta

from core.rules import (
    month_range,
    iter_days,
    is_employee_planning_active_month,
    is_employee_in_planning,
)
from database.repositories import employees_df, add_allocation, add_assignment


def t8_coverage_count(planned, day) -> int:
    return sum(1 for (_eid, d), sh in planned.items() if d == day and sh == "T8")


def day_needs_t8(planned, day) -> bool:
    return t8_coverage_count(planned, day) < 1


def _sched():
    from core import scheduler as s
    return s


def _pilot_can_host_block(
    emp, d1, d2, d3, blocked, planned,
    shift_map, shift_restrictions, max_monthly_work,
    strict=True, allow_fortnight_override=False,
) -> bool:
    s = _sched()
    emp_id = int(emp["id"])
    if not is_employee_in_planning(emp_id, d1):
        return False

    shift_win = s._pilot_shift_block_days(emp_id, d1.year, d1.month, include_fixed=False)
    if d1 not in shift_win or d2 not in shift_win:
        return False

    for d in (d1, d2, d3):
        bt = blocked.get((emp_id, d))
        if bt and str(bt).upper() != "ND":
            return False

    if planned.get((emp_id, d1)) and planned.get((emp_id, d1)) != "T8":
        return False
    if planned.get((emp_id, d2)) and planned.get((emp_id, d2)) != "T8":
        return False
    if planned.get((emp_id, d3)):
        return False

    ok1, _ = s.can_work(
        emp, d1, "T8", blocked, planned,
        shift_map=shift_map, shift_restrictions=shift_restrictions,
        max_monthly_work=max_monthly_work, strict=strict,
        allow_fortnight_override=allow_fortnight_override,
    )
    if not ok1:
        return False

    temp = dict(planned)
    temp[(emp_id, d1)] = "T8"
    ok2, _ = s.can_work(
        emp, d2, "T8", blocked, temp,
        shift_map=shift_map, shift_restrictions=shift_restrictions,
        max_monthly_work=max_monthly_work, strict=strict,
        allow_fortnight_override=allow_fortnight_override,
    )
    return ok2


def _place_t8_block(emp, d1, d2, d3, planned, blocked, created, log, note: str) -> None:
    emp_id = int(emp["id"])
    nome = emp.get("nome", "")
    if planned.get((emp_id, d1)) != "T8":
        planned[(emp_id, d1)] = "T8"
        created.append((str(d1), "T8", emp_id, note))
    if planned.get((emp_id, d2)) != "T8":
        planned[(emp_id, d2)] = "T8"
        created.append((str(d2), "T8", emp_id, note))
    if blocked.get((emp_id, d3)) != "ND":
        add_allocation(emp_id, d3, "ND", "Gerado automaticamente após 2 T8")
        blocked[(emp_id, d3)] = "ND"
    log.append({
        "tipo": "T8 BLOCO AUTO",
        "data": f"{d1} / {d2} / {d3}",
        "cargo": "PAO",
        "turno": "T8",
        "detalhe": f"{nome}: T8/T8/ND — {note}",
    })


def _pick_block_candidate(
    employees, d1, d2, d3, blocked, planned,
    shift_map, shift_restrictions, max_monthly_work,
    start_date, end_date, days,
):
    s = _sched()
    candidates = []
    for emp in employees:
        emp_id = int(emp["id"])
        if shift_restrictions and "T8" in shift_restrictions.get(emp_id, set()):
            continue
        for strict, override in ((True, False), (False, False), (False, True)):
            if not _pilot_can_host_block(
                emp, d1, d2, d3, blocked, planned,
                shift_map, shift_restrictions, max_monthly_work,
                strict=strict, allow_fortnight_override=override,
            ):
                continue
            load = s.current_month_workload(emp_id, planned, blocked, start_date, end_date)
            blocks = s._count_t8_blocks(emp_id, planned, blocked, days)
            score = s.employee_score(emp, d1, "T8", planned, fortnight_penalty=blocks * 60)
            score += int(emp.get("senioridade", 999)) * 0.05
            if blocks == 0:
                score -= 120  # prioriza quem ainda não tem bloco T8 no mês
            if int(emp.get("fixo", 0) or 0) == 1 and str(emp.get("turno_fixo") or "").upper() == "T8":
                score -= 30  # preferência T8 (não exclusiva)
            if override:
                score += 800
            elif not strict:
                score += 400
            candidates.append((load, score, int(emp.get("senioridade", 999)), emp))
            break
    if not candidates:
        return None
    candidates.sort(key=lambda x: (x[0], x[1], x[2]))
    return candidates[0][3]


def _try_single_t8_second_day(day, planned, blocked, shift_map, shift_restrictions, max_monthly_work, log) -> bool:
    """Fecha T8 quando o piloto já fez T8 no dia anterior (2º dia do par)."""
    s = _sched()
    prev = day - timedelta(days=1)
    employees = employees_df("PAO").to_dict("records")
    for emp in s._sort_by_seniority(employees):
        emp_id = int(emp["id"])
        if planned.get((emp_id, prev)) != "T8":
            continue
        if planned.get((emp_id, day)):
            continue
        ok, _ = s.can_work(
            emp, day, "T8", blocked, planned,
            shift_map=shift_map, shift_restrictions=shift_restrictions,
            max_monthly_work=max_monthly_work, strict=False, coverage_emergency=True,
        )
        if not ok:
            continue
        planned[(emp_id, day)] = "T8"
        add_assignment(str(day), "T8", emp_id, "Gerado automaticamente (Cobertura T8 — 2º dia par)")
        log.append({
            "tipo": "COBERTURA T8",
            "data": str(day),
            "cargo": "PAO",
            "turno": "T8",
            "detalhe": f"{emp.get('nome', '')}: T8 (2º dia do par) — cobertura inviolável.",
        })
        return True
    return False


def _try_month_end_t8_pair(
    day, year, month, planned, blocked, shift_map, shift_restrictions,
    max_monthly_work, start_date, end_date, log,
) -> bool:
    """Par T8/T8 no fim do mês; ND pode cair no 1º dia do mês seguinte."""
    s = _sched()
    days = list(iter_days(year, month))
    if day not in days:
        return False
    idx = days.index(day)
    pairs = []
    if idx >= 1:
        pairs.append((days[idx - 1], days[idx]))
    if idx + 1 < len(days):
        pairs.append((days[idx], days[idx + 1]))
    employees = [
        e for e in employees_df("PAO").to_dict("records")
        if is_employee_planning_active_month(int(e["id"]), year, month)
    ]
    for d1, d2 in pairs:
        d3 = d2 + timedelta(days=1)
        for emp in employees:
            emp_id = int(emp["id"])
            shift_win = s._pilot_shift_block_days(emp_id, year, month, include_fixed=False)
            if d1 not in shift_win or d2 not in shift_win:
                continue
            blocked_ok = True
            for d in (d1, d2):
                bt = blocked.get((emp_id, d))
                if bt and str(bt).upper() != "ND":
                    if not s._clear_clearable_allocation(emp_id, d, blocked):
                        blocked_ok = False
                        break
            if not blocked_ok:
                continue
            temp = dict(planned)
            placed = False
            for strict, emerg in ((True, False), (False, True)):
                ok1, _ = s.can_work(
                    emp, d1, "T8", blocked, temp,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=strict, coverage_emergency=emerg,
                )
                if not ok1:
                    continue
                temp[(emp_id, d1)] = "T8"
                ok2, _ = s.can_work(
                    emp, d2, "T8", blocked, temp,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=strict, coverage_emergency=emerg,
                )
                if not ok2:
                    continue
                if planned.get((emp_id, d1)) != "T8":
                    planned[(emp_id, d1)] = "T8"
                    add_assignment(str(d1), "T8", emp_id, "Gerado automaticamente (Cobertura T8 fim mês)")
                if planned.get((emp_id, d2)) != "T8":
                    planned[(emp_id, d2)] = "T8"
                    add_assignment(str(d2), "T8", emp_id, "Gerado automaticamente (Cobertura T8 fim mês)")
                if blocked.get((emp_id, d3)) != "ND":
                    add_allocation(emp_id, d3, "ND", "Gerado automaticamente após 2 T8 (fim mês)")
                    blocked[(emp_id, d3)] = "ND"
                log.append({
                    "tipo": "COBERTURA T8",
                    "data": f"{d1} / {d2}",
                    "cargo": "PAO",
                    "turno": "T8",
                    "detalhe": f"{emp.get('nome', '')}: T8/T8 + ND {d3} (fim de mês).",
                })
                placed = True
                break
            if placed and not day_needs_t8(planned, day):
                return True
    return False


def _try_emergency_single_t8(
    day, year, month, planned, blocked, shift_map, shift_restrictions,
    max_monthly_work, start_date, end_date, log,
) -> bool:
    """Último recurso: T8 isolado para cobertura inviolável (desbloqueia folga auto se preciso)."""
    s = _sched()
    employees = [
        e for e in employees_df("PAO").to_dict("records")
        if is_employee_planning_active_month(int(e["id"]), year, month)
    ]
    for emp in employees:
        s._force_clear_auto_rests_on_day(int(emp["id"]), day, blocked, log)
    for shift_code in ("T8",):
        picked = s._pick_by_seniority_cascade(
            employees, day, shift_code, blocked, planned,
            shift_map, shift_restrictions, max_monthly_work, False,
            start_date, end_date, role="PAO", include_emergency=True,
        )
        if picked:
            _, _, chosen, tag, _ = picked
            emp_id = int(chosen["id"])
            planned[(emp_id, day)] = shift_code
            add_assignment(str(day), shift_code, emp_id, "Gerado automaticamente (Cobertura T8 emergência)")
            log.append({
                "tipo": "COBERTURA T8",
                "data": str(day),
                "cargo": "PAO",
                "turno": "T8",
                "detalhe": f"{chosen['nome']} — T8 emergência ({tag or 'cobertura inviolável'}).",
            })
            return True
        for emp in s._sort_by_seniority(employees):
            eid = int(emp["id"])
            if (eid, day) in planned:
                continue
            if not s._clear_clearable_allocation(eid, day, blocked):
                continue
            picked = s._pick_by_seniority_cascade(
                employees, day, shift_code, blocked, planned,
                shift_map, shift_restrictions, max_monthly_work, False,
                start_date, end_date, role="PAO", include_emergency=True,
            )
            if picked:
                _, _, chosen, tag, _ = picked
                emp_id = int(chosen["id"])
                planned[(emp_id, day)] = shift_code
                add_assignment(str(day), shift_code, emp_id, "Gerado automaticamente (Cobertura T8 emergência)")
                log.append({
                    "tipo": "COBERTURA T8",
                    "data": str(day),
                    "cargo": "PAO",
                    "turno": "T8",
                    "detalhe": f"{chosen['nome']} — T8 emergência após desbloqueio.",
                })
                return True
    return False


def try_close_t8_gap(
    day, year, month, planned, blocked,
    shift_map, shift_restrictions, max_monthly_work,
    start_date, end_date, log,
) -> bool:
    """Fecha furo T8: bloco T8/T8/ND → 2º dia par → fim mês → emergência."""
    if not day_needs_t8(planned, day):
        return True

    days = list(iter_days(year, month))
    if day not in days:
        return False

    employees = [
        e for e in employees_df("PAO").to_dict("records")
        if is_employee_planning_active_month(int(e["id"]), year, month)
    ]
    idx = days.index(day)
    tries = []
    if idx + 2 < len(days):
        tries.append((days[idx], days[idx + 1], days[idx + 2]))
    if idx >= 1 and idx + 1 < len(days):
        tries.append((days[idx - 1], days[idx], days[idx + 1]))
    if idx >= 2:
        tries.append((days[idx - 2], days[idx - 1], days[idx]))

    for d1, d2, d3 in tries:
        chosen = _pick_block_candidate(
            employees, d1, d2, d3, blocked, planned,
            shift_map, shift_restrictions, max_monthly_work,
            start_date, end_date, days,
        )
        if not chosen:
            continue
        batch = []
        _place_t8_block(
            chosen, d1, d2, d3, planned, blocked, batch, log,
            "Cobertura T8 (bloco automático)",
        )
        for wd, sh, eid, note in batch:
            add_assignment(wd, sh, eid, note)
        if not day_needs_t8(planned, day):
            return True
    if _try_single_t8_second_day(day, planned, blocked, shift_map, shift_restrictions, max_monthly_work, log):
        return not day_needs_t8(planned, day)
    if _try_month_end_t8_pair(
        day, year, month, planned, blocked, shift_map, shift_restrictions,
        max_monthly_work, start_date, end_date, log,
    ):
        return not day_needs_t8(planned, day)
    if _try_emergency_single_t8(
        day, year, month, planned, blocked, shift_map, shift_restrictions,
        max_monthly_work, start_date, end_date, log,
    ):
        return not day_needs_t8(planned, day)
    return False


def automated_plan_t8_coverage(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions=None, max_monthly_work=None,
) -> None:
    """Cobre T6/T7/T8 — parte T8: blocos automáticos respeitando pré-alocações."""
    days = list(iter_days(year, month))
    start_date, end_date = month_range(year, month)
    employees = [
        e for e in employees_df("PAO").to_dict("records")
        if is_employee_planning_active_month(int(e["id"]), year, month)
    ]
    if not employees:
        return

    for _pass in range(4):
        progress = False
        for i in range(len(days) - 2):
            d1, d2, d3 = days[i], days[i + 1], days[i + 2]
            if not day_needs_t8(planned, d1) and not day_needs_t8(planned, d2):
                continue
            chosen = _pick_block_candidate(
                employees, d1, d2, d3, blocked, planned,
                shift_map, shift_restrictions, max_monthly_work,
                start_date, end_date, days,
            )
            if not chosen:
                continue
            _place_t8_block(
                chosen, d1, d2, d3, planned, blocked, created, log,
                "Gerado automaticamente (motor T8 único)",
            )
            progress = True
        if not progress:
            break

    for d in days:
        if day_needs_t8(planned, d):
            log.append({
                "tipo": "T8 SEM COBERTURA",
                "data": str(d),
                "cargo": "PAO",
                "turno": "T8",
                "detalhe": "Dia sem T8 após motor automático.",
            })

    ensure_minimum_t8_blocks_per_pilot(
        year, month, planned, blocked, created, log,
        shift_map, shift_restrictions, max_monthly_work,
    )


def ensure_minimum_t8_blocks_per_pilot(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions=None, max_monthly_work=None,
) -> None:
    """Garante ≥1 bloco T8/T8/ND por piloto elegível (até 2 se cobertura exigir)."""
    s = _sched()
    days = list(iter_days(year, month))
    start_date, end_date = month_range(year, month)
    employees = sorted(
        [
            e for e in employees_df("PAO").to_dict("records")
            if is_employee_planning_active_month(int(e["id"]), year, month)
        ],
        key=lambda e: int(e.get("senioridade", 999)),
    )
    for emp in employees:
        emp_id = int(emp["id"])
        if shift_restrictions and "T8" in shift_restrictions.get(emp_id, set()):
            continue
        is_fixed = int(emp.get("fixo", 0) or 0) == 1
        fixed_shift = str(emp.get("turno_fixo") or "").upper().strip()
        if is_fixed and fixed_shift and fixed_shift != "T8":
            continue
        if s._count_t8_blocks(emp_id, planned, blocked, days) >= 1:
            continue
        for i in range(len(days) - 2):
            d1, d2, d3 = days[i], days[i + 1], days[i + 2]
            if not day_needs_t8(planned, d1) and not day_needs_t8(planned, d2):
                if planned.get((emp_id, d1)) or planned.get((emp_id, d2)):
                    continue
            if not _pilot_can_host_block(
                emp, d1, d2, d3, blocked, planned,
                shift_map, shift_restrictions, max_monthly_work,
                strict=False, allow_fortnight_override=True,
            ):
                continue
            _place_t8_block(
                emp, d1, d2, d3, planned, blocked, created, log,
                "Bloco T8 mínimo obrigatório por piloto",
            )
            break
        else:
            log.append({
                "tipo": "T8 MINIMO PENDENTE",
                "data": f"{month:02d}/{year}",
                "cargo": "PAO",
                "turno": "T8",
                "detalhe": f"{emp.get('nome', '')}: não foi possível alocar bloco T8 mínimo.",
            })
