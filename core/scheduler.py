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
    apao_has_no_other_apao_overlap,
    apao_shortfall_on_day,
    pao_shift_capacity_on_day,
    build_employee_role_map,
    monthly_work_count,
    monthly_rest_count,
    build_shift_time_map,
    BLOCK_TYPES,
    is_employee_on_vacation,
    is_employee_in_planning,
    is_employee_planning_active_month,
    employee_plannable_days,
    is_employee_on_vacation_fortnight,
    employee_productive_target,
)

def _is_auto_generated_note(notes):
    n = str(notes or "").strip()
    return n.startswith("Gerado automaticamente") or n.startswith("Ajustado automaticamente")

def _manual_assignment_keys(start_date, end_date, employee_ids=None):
    sched = schedule_df(start_date, end_date)
    keys = set()
    if sched.empty:
        return keys
    for _, r in sched.iterrows():
        eid = int(r["funcionario_id"])
        if employee_ids is not None and eid not in employee_ids:
            continue
        if not _is_auto_generated_note(r.get("observacao", "")):
            keys.add((eid, pd.to_datetime(r["data"]).date()))
    return keys

def _last_work_shift_before(emp_id, day, planned):
    d = pd.to_datetime(day).date() - timedelta(days=1)
    for _ in range(15):
        sh = planned.get((emp_id, d))
        if sh:
            return sh
        sched = schedule_df(d, d)
        if not sched.empty:
            sub = sched[sched["funcionario_id"] == int(emp_id)]
            if not sub.empty:
                return sub.iloc[0]["turno"]
        d -= timedelta(days=1)
    return None

def _remove_auto_assignment_if_any(emp_id, d, planned):
    """Remove turno gerado automaticamente para liberar dia de folga 6x1."""
    sched = schedule_df(d, d)
    if sched.empty:
        return False
    sub = sched[sched["funcionario_id"] == int(emp_id)]
    if sub.empty:
        return False
    notes = str(sub.iloc[0].get("observacao", "") or "")
    if not _is_auto_generated_note(notes):
        return False
    execute(
        "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
        (int(emp_id), str(d)),
    )
    planned.pop((int(emp_id), pd.to_datetime(d).date()), None)
    return True


def _schedule_rest_if_six_complete(emp_id, work_day, year, month, planned, blocked, manual, log, emp_nome=""):
    """Insere folga obrigatória no dia seguinte ao 6º dia consecutivo de trabalho."""
    next_d = work_day + timedelta(days=1)
    _, end_date = month_range(year, month)
    if next_d > end_date:
        return False
    if consecutive_work_count(emp_id, next_d, planned) < 6:
        return False
    if (emp_id, next_d) in manual:
        return False
    rest_kinds = {
        "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
        "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO", "FÉRIAS", "DISPENSA MÉDICA",
    }
    if str(blocked.get((emp_id, next_d), "")).upper() in rest_kinds:
        return False
    if planned.get((emp_id, next_d)):
        if not _remove_auto_assignment_if_any(emp_id, next_d, planned):
            return False
    add_allocation(emp_id, next_d, "FOLGA", "Gerado automaticamente (Folga 6x1)")
    blocked[(emp_id, next_d)] = "FOLGA"
    if log is not None:
        log.append({
            "tipo": "FOLGA 6X1",
            "data": str(next_d),
            "cargo": "PAO",
            "turno": "-",
            "detalhe": f"{emp_nome or emp_id}: folga obrigatória após 6 dias consecutivos (último turno em {work_day}).",
        })
    return True


def _enforce_mandatory_6x1_rests(year, month, log=None):
    """Varredura final: garante folga após cada bloco de 6 dias (inclui continuidade do mês anterior)."""
    start_date, end_date = month_range(year, month)
    prev_day = start_date - timedelta(days=1)
    manual = _manual_assignment_keys(start_date, end_date)

    planned = {}
    sched = schedule_df(prev_day, end_date)
    if not sched.empty:
        for _, r in sched.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    blocked = {}
    alloc = allocations_df(prev_day, end_date)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    fixed = 0
    for role in ["PAO", "APAO"]:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue
        for _, emp in emp_df.iterrows():
            emp_id = int(emp["id"])
            nome = emp["nome"]
            for d in iter_days(year, month):
                if not planned.get((emp_id, d)):
                    continue
                if _schedule_rest_if_six_complete(
                    emp_id, d, year, month, planned, blocked, manual, log, emp_nome=nome,
                ):
                    fixed += 1
    return fixed


MIN_MONTHLY_RESTS = 10
TARGET_MAX_MONTHLY_RESTS = 11
HARD_MAX_MONTHLY_RESTS = 12
EXACT_MONTHLY_RESTS = MIN_MONTHLY_RESTS  # compat


def _query_rest_rows(emp_id, start_date, end_date):
    from core.spreadsheet_validator import REST_COUNT_TYPES
    from database.connection import query_df

    return query_df(
        """
        SELECT id, alloc_date, alloc_type, notes
        FROM allocations
        WHERE employee_id = ? AND alloc_date BETWEEN ? AND ?
        AND alloc_type IN ({})
        """.format(",".join(["?"] * len(REST_COUNT_TYPES))),
        tuple([emp_id, str(start_date), str(end_date)] + list(REST_COUNT_TYPES)),
    )


def _pick_removable_rest_row(rows):
    auto_rows = rows[rows["notes"].astype(str).str.contains(
        "Gerado automaticamente|Preenchimento", na=False, regex=True,
    )]
    if auto_rows.empty:
        auto_rows = rows[~rows["alloc_type"].isin(["FOLGA PEDIDA", "FOLGA ESCOLHIDA"])]
    if auto_rows.empty:
        return None
    drop = auto_rows.sort_values("alloc_date", ascending=False).iloc[0]
    return int(drop["id"]), drop


def _enforce_rest_quota(year, month, log=None):
    """
    Folgas PAO/PAO FCF: mínimo 10, preferência até 11, máximo 12 só se inevitável.
    """
    start_date, end_date = month_range(year, month)
    from database.connection import query_df

    fixed = 0
    for role in ["PAO", "PAO FCF"]:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue
        for _, emp in emp_df.iterrows():
            emp_id = int(emp["id"])
            nome = emp["nome"]
            if not is_employee_planning_active_month(emp_id, year, month):
                continue

            rows = _query_rest_rows(emp_id, start_date, end_date)

            while len(rows) > TARGET_MAX_MONTHLY_RESTS:
                picked = _pick_removable_rest_row(rows)
                if picked is None:
                    break
                drop_id, drop = picked
                execute("DELETE FROM allocations WHERE id = ?", (drop_id,))
                rows = rows[rows["id"] != drop_id]
                fixed += 1
                if log is not None:
                    log.append({
                        "tipo": "FOLGA QUOTA",
                        "data": str(drop["alloc_date"]),
                        "cargo": role,
                        "turno": "-",
                        "detalhe": f"{nome}: removida folga extra ({len(rows)+1}→{len(rows)}, meta máx. 11).",
                    })

            while len(rows) > HARD_MAX_MONTHLY_RESTS:
                picked = _pick_removable_rest_row(rows)
                if picked is None:
                    break
                drop_id, drop = picked
                execute("DELETE FROM allocations WHERE id = ?", (drop_id,))
                rows = rows[rows["id"] != drop_id]
                fixed += 1
                if log is not None:
                    log.append({
                        "tipo": "FOLGA QUOTA",
                        "data": str(drop["alloc_date"]),
                        "cargo": role,
                        "turno": "-",
                        "detalhe": f"{nome}: removida folga acima do teto 12 ({drop['alloc_type']}).",
                    })

            while len(rows) < MIN_MONTHLY_RESTS:
                placed = False
                for d in employee_plannable_days(emp_id, year, month):
                    if len(rows) >= MIN_MONTHLY_RESTS:
                        break
                    if is_employee_on_vacation(emp_id, d):
                        continue
                    sched_day = schedule_df(d, d)
                    if not sched_day.empty and not sched_day[sched_day["funcionario_id"] == emp_id].empty:
                        continue
                    existing = query_df(
                        "SELECT 1 FROM allocations WHERE employee_id = ? AND alloc_date = ?",
                        (emp_id, str(d)),
                    )
                    if not existing.empty:
                        continue
                    add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente (Meta folgas 10–11)")
                    fixed += 1
                    placed = True
                    if log is not None:
                        log.append({
                            "tipo": "FOLGA QUOTA",
                            "data": str(d),
                            "cargo": role,
                            "turno": "-",
                            "detalhe": f"{nome}: folga adicionada para atingir mínimo 10.",
                        })
                    rows = _query_rest_rows(emp_id, start_date, end_date)
                if not placed:
                    break

            if len(rows) == HARD_MAX_MONTHLY_RESTS:
                picked = _pick_removable_rest_row(rows)
                if picked is not None:
                    drop_id, drop = picked
                    execute("DELETE FROM allocations WHERE id = ?", (drop_id,))
                    fixed += 1
                    if log is not None:
                        log.append({
                            "tipo": "FOLGA QUOTA",
                            "data": str(drop["alloc_date"]),
                            "cargo": role,
                            "turno": "-",
                            "detalhe": f"{nome}: 12→11 folgas (caso especial evitado).",
                        })
                elif log is not None:
                    log.append({
                        "tipo": "FOLGA QUOTA AVISO",
                        "data": "-",
                        "cargo": role,
                        "turno": "-",
                        "detalhe": f"{nome}: 12 folgas — inevitável (pré-alocações/6x1).",
                    })

            elif len(rows) == MIN_MONTHLY_RESTS:
                rest_dates = {pd.to_datetime(r["alloc_date"]).date() for _, r in rows.iterrows()}
                for d in employee_plannable_days(emp_id, year, month):
                    if len(rows) >= TARGET_MAX_MONTHLY_RESTS:
                        break
                    if is_employee_on_vacation(emp_id, d):
                        continue
                    sched_day = schedule_df(d, d)
                    if not sched_day.empty and not sched_day[sched_day["funcionario_id"] == emp_id].empty:
                        continue
                    existing = query_df(
                        "SELECT 1 FROM allocations WHERE employee_id = ? AND alloc_date = ?",
                        (emp_id, str(d)),
                    )
                    if not existing.empty:
                        continue
                    if (d - timedelta(days=1) in rest_dates) or (d + timedelta(days=1) in rest_dates):
                        add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente (11ª folga agrupada)")
                        fixed += 1
                        if log is not None:
                            log.append({
                                "tipo": "FOLGA QUOTA",
                                "data": str(d),
                                "cargo": role,
                                "turno": "-",
                                "detalhe": f"{nome}: 11ª folga adjacente ao bloco.",
                            })
                        break
    return fixed


def _enforce_exact_ten_rests(year, month, log=None):
    """Compat: delega para quota 10–11 (máx. 12)."""
    return _enforce_rest_quota(year, month, log=log)


def count_visual_blank_cells(year: int, month: int) -> int:
    """Conta células vazias na grade visual (PAO + PAO FCF), exceto dias de férias."""
    from services.exporter_pdf import build_visual_schedule_dataframe
    from ui.components import is_visual_day_column
    from database.repositories import employees_df as _emp_df

    visual = build_visual_schedule_dataframe(year, month)
    if visual.empty:
        return 0
    day_cols = [c for c in visual.columns if is_visual_day_column(c)]
    pao_rows = visual[visual["Cargo"].isin(["PAO", "PAO FCF", "APAO"])] if "Cargo" in visual.columns else visual
    emps = _emp_df()
    total = 0
    for _, row in pao_rows.iterrows():
        nome = row.get("Funcionário", row.get("funcionario", ""))
        emp_match = emps[emps["nome"] == nome] if not emps.empty else emps
        emp_id = int(emp_match.iloc[0]["id"]) if not emp_match.empty else None
        for col in day_cols:
            if str(row.get(col, "")).strip():
                continue
            if emp_id is not None:
                try:
                    d = date(int(year), int(month), int(str(col).strip()))
                except Exception:
                    total += 1
                    continue
                if is_employee_on_vacation(emp_id, d):
                    continue
            total += 1
    return total


def enforce_t8_t8_nd_month(year: int, month: int, log=None) -> int:
    """
    Reaplica T8,T8,ND após fechamentos de cobertura.
    - Máximo 2 T8 consecutivos por piloto; 3º dia = ND
    - Pareia T8 isolado ou converte via repair
    """
    from services.schedule_service import ScheduleService

    start_date, end_date = month_range(year, month)
    days = list(iter_days(year, month))
    fixes = 0

    for role in ["PAO", "PAO FCF"]:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue
        for _, emp in emp_df.iterrows():
            emp_id = int(emp["id"])
            emp_nome = emp["nome"]
            if role == "PAO FCF":
                continue
            if not is_employee_planning_active_month(emp_id, year, month):
                continue

            planned, blocked, days_in_month, start_date, end_date = _reload_employee_planned_blocked(emp_id, year, month)
            days = days_in_month
            created = []

            i = 0
            while i < len(days):
                d = days[i]
                if planned.get((emp_id, d)) != "T8":
                    i += 1
                    continue
                streak = [d]
                j = i + 1
                while j < len(days) and planned.get((emp_id, days[j])) == "T8":
                    streak.append(days[j])
                    j += 1

                if len(streak) >= 2:
                    nd_day = streak[1] + timedelta(days=1)
                    if nd_day <= end_date and _nd_required_after_t8_pair(emp_id, nd_day, planned):
                        if _ensure_nd_after_t8(emp_id, nd_day, planned, blocked, emp_nome, role, created):
                            fixes += 1
                            if log is not None:
                                log.append({
                                    "tipo": "T8/T8/ND",
                                    "data": str(nd_day),
                                    "cargo": role,
                                    "turno": "ND",
                                    "detalhe": f"{emp_nome}: ND obrigatório após par T8.",
                                })

                for extra_d in streak[2:]:
                    execute(
                        "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
                        (emp_id, str(extra_d)),
                    )
                    planned.pop((emp_id, extra_d), None)
                    fixes += 1
                    if log is not None:
                        log.append({
                            "tipo": "T8/T8/ND",
                            "data": str(extra_d),
                            "cargo": role,
                            "turno": "T8",
                            "detalhe": f"{emp_nome}: T8 extra removido (máx. 2 seguidos).",
                        })

                i = j

            for d in days:
                if planned.get((emp_id, d)) == "T8":
                    for repair_log in ScheduleService.repair_employee_rules(emp_id, d):
                        fixes += 1
                        if log is not None:
                            log.append({
                                "tipo": repair_log.get("tipo", "T8/T8/ND"),
                                "data": str(repair_log.get("data", d)),
                                "cargo": role,
                                "turno": "-",
                                "detalhe": repair_log.get("detalhe", ""),
                            })

    return fixes


def fill_schedule_blank_cells(year: int, month: int, log=None) -> int:
    """Preenche dias em branco na grade com VOO (respeitando meta de 10 folgas)."""
    from services.schedule_service import ScheduleService

    before = count_visual_blank_cells(year, month)
    if before == 0:
        return 0
    changes = ScheduleService.fill_blank_cells_with_flights(year, month)
    filled = len(changes) if not changes.empty else 0
    after = count_visual_blank_cells(year, month)
    if log is not None and filled:
        log.append({
            "tipo": "DIAS EM BRANCO",
            "data": "-",
            "cargo": "PAO/APAO",
            "turno": "-",
            "detalhe": f"Preenchidos {filled} dia(s) vazio(s) com VOO ({before} → {after} células vazias).",
        })
    return filled


def complete_pao_carryover_6x1(year, month, planned, blocked, created, log, shift_map, shift_restrictions, max_monthly_work, strict=True):
    """Carryover 6x1: só bloqueia folga no dia 1 se streak>=6 (não preenche turnos)."""
    from core.coverage_gate import enforce_month_start_6x1_from_previous

    enforce_month_start_6x1_from_previous(year, month, planned, blocked, log, roles=("PAO",))
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

def _count_t8_blocks(emp_id, planned, blocked, days):
    """Quantos blocos T8,T8,ND o funcionário já tem no mês."""
    count = 0
    for i in range(len(days) - 2):
        d1, d2, d3 = days[i], days[i + 1], days[i + 2]
        if (
            planned.get((emp_id, d1)) == "T8"
            and planned.get((emp_id, d2)) == "T8"
            and blocked.get((emp_id, d3)) == "ND"
        ):
            count += 1
    return count


def month_day_blocks(year, month):
    """Divide o mês em 3 blocos: 31→11/10/10, 30→10/10/10, 28→10/9/9."""
    days = list(iter_days(year, month))
    n = len(days)
    if n == 31:
        sizes = [11, 10, 10]
    elif n == 30:
        sizes = [10, 10, 10]
    elif n == 28:
        sizes = [10, 9, 9]
    elif n == 29:
        sizes = [10, 10, 9]
    else:
        base = n // 3
        sizes = [base, base, n - 2 * base]
    blocks = []
    i = 0
    for sz in sizes:
        blocks.append(days[i:i + sz])
        i += sz
    return blocks


def get_block_group(emp_id, year, month, include_fixed=False):
    """
    Grupos A/B/C por senioridade — cada um trabalha 2 blocos (~20 dias) e fica off em 1 (~10 dias).
    A → blocos 1+2 off bloco 3 | B → blocos 2+3 off bloco 1 | C → blocos 1+3 off bloco 2
    """
    from database.repositories import employees_df
    df = employees_df("PAO")
    if df.empty:
        return None
    if not include_fixed:
        df = df[df["fixo"] != 1]
        if df.empty:
            return None
    pao_ids = df["id"].tolist()
    if len(pao_ids) < 3:
        return None
    if emp_id not in pao_ids:
        return None
    idx = pao_ids.index(emp_id)
    n = len(pao_ids)
    t1 = (n + 2) // 3
    t2 = (2 * n + 2) // 3
    if idx < t1:
        return "A"
    if idx < t2:
        return "B"
    return "C"


def get_fortnight_group(emp_id, year, month, include_fixed=False):
    """Compat: retorna grupo de rotação A/B/C (blocos ~10 dias — substitui quinzena)."""
    return get_block_group(emp_id, year, month, include_fixed=include_fixed)


def _block_group_shift_indices(grp):
    """Cada piloto trabalha 2 blocos (~20 dias) e fica off em 1 bloco (~10 dias)."""
    return {
        "A": {0, 1},
        "B": {1, 2},
        "C": {0, 2},
    }.get(grp, set())


def _block_group_off_index(grp):
    return {"A": 2, "B": 0, "C": 1}.get(grp)


def _pilot_shift_block_days(emp_id, year, month, include_fixed=True):
    grp = get_block_group(emp_id, year, month, include_fixed=include_fixed)
    if not grp:
        return set(iter_days(year, month))
    blocks = month_day_blocks(year, month)
    days = set()
    for i in _block_group_shift_indices(grp):
        days.update(blocks[i])
    return days


def _pilot_off_block_days(emp_id, year, month, include_fixed=True):
    grp = get_block_group(emp_id, year, month, include_fixed=include_fixed)
    if not grp:
        return set()
    blocks = month_day_blocks(year, month)
    off_i = _block_group_off_index(grp)
    if off_i is None:
        return set()
    return set(blocks[off_i])


def _shift_fortnight_window(emp_id, year, month):
    """Dias do bloco de turno (~10 dias) do piloto."""
    return sorted(_pilot_shift_block_days(emp_id, year, month, include_fixed=True))


def _fortnight_voo_window(emp_id, year, month):
    """Dias off (2 blocos ~20 dias) para VOO/folgas."""
    return sorted(_pilot_off_block_days(emp_id, year, month, include_fixed=True))


def _folga_placement_days(emp_id, year, month, free_days):
    """Prioriza folgas no bloco de turno (reserva blocos off para VOO)."""
    if not get_block_group(emp_id, year, month, include_fixed=True):
        return free_days
    shift_win = _pilot_shift_block_days(emp_id, year, month, include_fixed=True)
    preferred = [d for d in free_days if d in shift_win]
    return preferred if preferred else list(free_days)


def _reclaim_voo_fortnight_from_auto_folgas(emp_id, year, month):
    """Remove folgas automáticas na quinzena de VOO para liberar blocos de voo."""
    voo_days = set(_fortnight_voo_window(emp_id, year, month))
    if not voo_days:
        return
    protected = {
        "FOLGA PEDIDA", "FOLGA SOCIAL", "FOLGA ESCOLHIDA", "FOLGA ANIVERSÁRIO",
        "FÉRIAS", "CURSO ONLINE", "DISPENSA MÉDICA", "SIMULADOR", "VOO", "ND",
    }
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    if alloc.empty:
        return
    sub = alloc[alloc["funcionario_id"] == int(emp_id)]
    for _, r in sub.iterrows():
        d = pd.to_datetime(r["data"]).date()
        if d not in voo_days:
            continue
        tipo = str(r["tipo"]).upper()
        if tipo in protected:
            continue
        notes = str(r.get("observacao", r.get("notas", "")) or "")
        if not notes.startswith("Gerado automaticamente"):
            continue
        sched = schedule_df(d, d)
        if not sched.empty and not sched[sched["funcionario_id"] == int(emp_id)].empty:
            continue
        execute(
            "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ?",
            (int(emp_id), str(d)),
        )


def _is_protected_prealloc(tipo):
    """L=Férias, K=Curso, FP=Folga pedida — nunca sobrescrever."""
    return str(tipo or "").upper() in {
        "FÉRIAS", "FERIAS", "CURSO ONLINE", "FOLGA PEDIDA",
        "DISPENSA MÉDICA", "SIMULADOR", "CMA",
    }


def _strip_auto_shifts_from_wrong_fortnight(emp_id, year, month):
    """Remove turnos automáticos nos blocos off (só deve trabalhar no bloco de turno)."""
    off_days = _pilot_off_block_days(emp_id, year, month, include_fixed=True)
    if not off_days:
        return
    for d in iter_days(year, month):
        if d not in off_days:
            continue
        sched = schedule_df(d, d)
        if sched.empty:
            continue
        sub = sched[sched["funcionario_id"] == int(emp_id)]
        if sub.empty:
            continue
        if not _is_auto_generated_note(sub.iloc[0].get("observacao", "")):
            continue
        execute(
            "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
            (int(emp_id), str(d)),
        )


def _spreadsheet_fill_voo_fortnight(emp_id, emp, role, year, month, get_status, append_voo, append_folga):
    """Preenche a quinzena de VOO como na planilha: blocos de V, ou folgas se sem voo."""
    voo_days = set(_fortnight_voo_window(emp_id, year, month))
    if not voo_days:
        return
    _reclaim_voo_fortnight_from_auto_folgas(emp_id, year, month)

    sample_day = next(iter(sorted(voo_days)))
    can_voo = employee_can_receive_flight(emp, sample_day)

    rest_set, free_days = get_status()
    window_free = sorted(d for d in free_days if d in voo_days)

    if not can_voo:
        while len(window_free) >= 2:
            d1, d2 = window_free[0], window_free[1]
            if d2 == d1 + timedelta(days=1):
                append_folga(d1, "FOLGA (Quinzena — sem VOO)")
                append_folga(d2, "FOLGA (Quinzena — sem VOO)")
            else:
                append_folga(d1, "FOLGA (Quinzena — sem VOO)")
            rest_set, free_days = get_status()
            window_free = sorted(d for d in free_days if d in voo_days)
        if len(window_free) == 1:
            append_folga(window_free[0], "FOLGA (Quinzena — sem VOO)")
        return

    for run in _consecutive_runs(window_free):
        for d in run:
            append_voo(d, "Gerado automaticamente (VOO quinzena — planilha)", "VOO (Quinzena)")
        rest_set, free_days = get_status()
        window_free = sorted(d for d in free_days if d in voo_days)

    rest_set, free_days = get_status()
    window_free = sorted(d for d in free_days if d in voo_days)
    while window_free:
        d = window_free[0]
        if append_voo(d, "Gerado automaticamente (VOO quinzena — planilha)", "VOO (Quinzena)"):
            rest_set, free_days = get_status()
            window_free = sorted(x for x in free_days if x in voo_days)
            continue
        break

    rest_set, free_days = get_status()
    window_free = sorted(d for d in free_days if d in voo_days)
    if len(window_free) == 1 and role == "APAO":
        append_folga(window_free[0], "FOLGA (Quinzena)")
    elif len(window_free) == 1:
        d = window_free[0]
        if len(_isolated_rest_days(rest_set)) < 1:
            append_folga(d, "FOLGA (Única isolada quinzena)")
        else:
            append_voo(d, "Gerado automaticamente (VOO quinzena — planilha)", "VOO (Quinzena)")


def _isolated_rest_days(rest_set):
    isolated = []
    for d in sorted(rest_set):
        if (d - timedelta(days=1)) not in rest_set and (d + timedelta(days=1)) not in rest_set:
            isolated.append(d)
    return isolated


def _consecutive_runs(dates):
    if not dates:
        return []
    ordered = sorted(dates)
    runs, run = [], [ordered[0]]
    for d in ordered[1:]:
        if d == run[-1] + timedelta(days=1):
            run.append(d)
        else:
            runs.append(run)
            run = [d]
    runs.append(run)
    return runs


def _fill_remaining_folgas_no_monofolga(role, needed, get_status, append_folga, append_voo, emp_id, year, month):
    """PAO/PAO FCF: no máximo 1 monofolga; demais folgas em pares ou VOO na quinzena de voo."""
    mono_limit = 999 if role == "APAO" else 1
    while needed > 0:
        rest_set, free_days = get_status()
        if not free_days:
            break
        isolated = _isolated_rest_days(rest_set)
        pair = _best_consecutive_pair(free_days, rest_set)
        if needed >= 2 and pair:
            append_folga(pair[0], "FOLGA (Par)")
            append_folga(pair[1], "FOLGA (Par)")
            needed -= 2
            continue
        if needed == 1 and pair:
            append_folga(pair[0], "FOLGA (Par)")
            append_folga(pair[1], "FOLGA (Par 11º Dia)")
            needed = 0
            continue
        if needed >= 2 and len(free_days) >= 2 and free_days[1] == free_days[0] + timedelta(days=1):
            append_folga(free_days[0], "FOLGA (Par)")
            append_folga(free_days[1], "FOLGA (Par)")
            needed -= 2
            continue
        if needed == 1 and len(isolated) < mono_limit:
            append_folga(free_days[0], "FOLGA (Única isolada)")
            needed = 0
            continue
        voo_win = set(_fortnight_voo_window(emp_id, year, month))
        if any(d in voo_win and append_voo(d, "Gerado automaticamente (VOO quinzena)", "VOO (Quinzena)") for d in free_days):
            continue
        break
    return needed


def _allocate_voo_pool(emp, emp_id, role, year, month, days_in_month, start_date, end_date,
                       get_status, append_voo, shift_days_fn):
    """Preenche dias livres com VOO — prioriza quinzena de voo (Grupo A: 16–fim)."""
    rest_kinds = {
        "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
        "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO", "FÉRIAS",
    }
    voo_window = set(_fortnight_voo_window(emp_id, year, month))

    def try_voo_on(days, note, label):
        shift_days = shift_days_fn()
        for d in days:
            if d < start_date or d > end_date:
                continue
            if _voo_isolated_between_shifts(d, shift_days):
                continue
            if append_voo(d, note, label):
                shift_days = shift_days_fn()

    rest_set, free_days = get_status()
    window_free = [d for d in free_days if d in voo_window]
    for run in _consecutive_runs(window_free):
        try_voo_on(run, "Gerado automaticamente (VOO quinzena agrupado)", "VOO (Quinzena)")
        rest_set, free_days = get_status()
        window_free = [d for d in free_days if d in voo_window]
    for d in list(window_free):
        append_voo(d, "Gerado automaticamente (VOO quinzena)", "VOO (Quinzena)")
        rest_set, free_days = get_status()

    rest_set, free_days = get_status()
    folga_only = set()
    alloc = allocations_df(start_date, end_date)
    if not alloc.empty:
        sub = alloc[alloc["funcionario_id"] == emp_id]
        for _, r in sub.iterrows():
            if r["tipo"] in rest_kinds:
                folga_only.add(pd.to_datetime(r["data"]).date())

    for run in _consecutive_runs(free_days):
        touches_rest = any(
            (d - timedelta(days=1) in folga_only) or (d + timedelta(days=1) in folga_only)
            for d in run
        )
        if len(run) >= 2 or touches_rest or role == "PAO FCF":
            try_voo_on(run, "Preenchimento rápido de células vazias", "VOO (Preenchimento)")

    if role != "APAO":
        folga_only = set()
        alloc = allocations_df(start_date, end_date)
        if not alloc.empty:
            sub = alloc[alloc["funcionario_id"] == emp_id]
            for _, r in sub.iterrows():
                if r["tipo"] in rest_kinds:
                    folga_only.add(pd.to_datetime(r["data"]).date())
        isolated = _isolated_rest_days(folga_only)
        for d in isolated[1:]:
            execute(
                "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ? "
                "AND alloc_type IN ('FOLGA','FOLGA SOCIAL') AND notes LIKE 'Gerado automaticamente%'",
                (emp_id, str(d)),
            )
            append_voo(d, "Gerado automaticamente (VOO substitui monofolga)", "VOO (Anti-monofolga)")


def _enforce_max_one_monofolga(emp_id, role, year, month, append_voo):
    """PAO/PAO FCF: converte monofolgas extras em VOO (máximo 1 folga isolada no mês)."""
    if role == "APAO":
        return
    start_date, end_date = month_range(year, month)
    rest_kinds = {
        "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
        "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
    }
    while True:
        alloc = allocations_df(start_date, end_date)
        sub = alloc[alloc["funcionario_id"] == emp_id] if not alloc.empty else alloc
        rest_dates = set()
        if not sub.empty:
            for _, r in sub.iterrows():
                if r["tipo"] in rest_kinds:
                    rest_dates.add(pd.to_datetime(r["data"]).date())
        isolated = _isolated_rest_days(rest_dates)
        if len(isolated) <= 1:
            break
        d = sorted(isolated)[1]
        merged = False
        for neighbor in (d - timedelta(days=1), d + timedelta(days=1)):
            if neighbor < start_date or neighbor > end_date or neighbor in rest_dates:
                continue
            sched = schedule_df(neighbor, neighbor)
            if not sched.empty and not sched[sched["funcionario_id"] == emp_id].empty:
                continue
            add_allocation(emp_id, neighbor, "FOLGA", "Gerado automaticamente (Par anti-monofolga)")
            merged = True
            break
        if merged:
            continue
        execute("DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ?", (emp_id, str(d)))
        add_allocation(emp_id, d, "VOO", "Gerado automaticamente (VOO substitui monofolga extra)")


def employee_can_receive_flight(emp_row, target_date):
    """Verifica se o funcionário pode receber VOO automático (PAO, PAO FCF, APAO)."""
    cargo = str(emp_row.get("cargo", emp_row.get("role", ""))).upper()
    if cargo not in ["PAO", "PAO FCF", "APAO"]:
        return False

    emp_id = int(emp_row["id"])
    target = pd.to_datetime(target_date).date()
    if not is_employee_in_planning(emp_id, target):
        return False

    if cargo == "PAO":
        if target in _pilot_shift_block_days(emp_id, target.year, target.month, include_fixed=True):
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

def can_work(emp, day, shift_code, blocked, planned, shift_map=None, shift_restrictions=None, max_monthly_work=None, strict=True, allow_fortnight_override=False, coverage_emergency=False):
    """Verifica se o funcionário pode assumir o turno na data sob os parâmetros fornecidos."""
    emp_id = int(emp["id"])
    cargo = str(emp.get("cargo", emp.get("role", ""))).strip().upper()
    block_override = allow_fortnight_override or coverage_emergency

    if not is_employee_in_planning(emp_id, day):
        return False, "de férias — fora do planejamento"

    # 1. Restrição estrita de turno para PAO regular
    if cargo == "PAO":
        if shift_code in {"T1", "T2", "T3", "T4"}:
            return False, f"PAO não pode assumir turno de APAO ({shift_code})"
        if shift_code not in {"T6", "T7", "T8"}:
            return False, f"PAO só pode assumir turnos T6, T7, T8 (proposto: {shift_code})"

        role_map = build_employee_role_map()
        cap = pao_shift_capacity_on_day(day, shift_code, planned, role_map, apao_substitute=True)
        current = sum(
            1 for (eid, d), sh in planned.items()
            if d == day and sh == shift_code and str(role_map.get(int(eid), "")) == "PAO"
        )
        if current >= cap and (emp_id, day) not in planned:
            return False, f"turno {shift_code} já atinge capacidade ({cap} PAO)"
        
        if not block_override:
            grp = get_block_group(emp_id, day.year, day.month)
            if grp and shift_code in {"T6", "T7", "T8"}:
                if day in _pilot_off_block_days(emp_id, day.year, day.month, include_fixed=False):
                    return False, f"PAO Grupo {grp} fora do bloco de turno (blocos off)"

    # 2. Concorrência PAO FCF (no double PAO FCF working/active on the same day)
    if cargo == "PAO FCF":
        role_map = build_employee_role_map()
        for (other_id, other_day), other_shift in planned.items():
            if other_day == day and int(other_id) != emp_id:
                if role_map.get(int(other_id)) == "PAO FCF" and other_shift:
                    return False, f"outro PAO FCF (ID: {other_id}) já está escalado no dia"
        for (other_id, other_day), block_type in blocked.items():
            if other_day == day and int(other_id) != emp_id:
                if role_map.get(int(other_id)) == "PAO FCF":
                    if str(block_type).strip().upper() in ["SIMULADOR", "CURSO ONLINE", "VOO"]:
                        return False, f"outro PAO FCF (ID: {other_id}) está ativo em {block_type} no dia"

    if (emp_id, day) in blocked:
        block_type = str(blocked[(emp_id, day)]).strip().upper()
        if _is_protected_prealloc(block_type):
            return False, f"bloqueado inviolável: {blocked[(emp_id, day)]}"
        if block_type in {
            "FOLGA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
        }:
            if not coverage_emergency:
                return False, f"bloqueado (folga): {blocked[(emp_id, day)]}"
        if coverage_emergency:
            pass
        elif cargo == "PAO FCF" and block_type in ["SIMULADOR", "CURSO ONLINE", "VOO"]:
            pass
        else:
            return False, f"bloqueado: {blocked[(emp_id, day)]}"

    if shift_restrictions is not None and not coverage_emergency:
        restricted = shift_restrictions.get(emp_id, set())
        if str(shift_code).upper() in restricted:
            return False, f"turno {shift_code} bloqueado para o funcionário neste mês"

    if max_monthly_work is not None and not coverage_emergency:
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
        if not ok_rest and not coverage_emergency:
            return False, rest_reason

        if max_simultaneous_workers_if_added(emp_id, day, shift_code, planned, shift_map) > 2:
            return False, "limite físico de 2 estações simultâneas"

        if role_for_shift(shift_code, shift_map) == "APAO" and cargo.startswith("APAO"):
            if not apao_has_no_other_apao_overlap(emp_id, day, shift_code, planned, shift_map):
                return False, "dois APAOs simultâneos não permitido"

    if shift_map is not None and role_for_shift(shift_code, shift_map) == "APAO" and cargo.startswith("APAO"):
        if consecutive_work_count(emp_id, day, planned) >= 6:
            return False, "APAO precisa folgar após 6 dias consecutivos"

    if cargo != "PAO FCF" and not coverage_emergency:
        if consecutive_work_count(emp_id, day, planned) >= 6:
            return False, "mais de 6 dias consecutivos"

        if shift_code == "T8" and t8_previous_count(emp_id, day, planned) >= 2:
            return False, "T8 após 2 dias consecutivos"

    if int(emp.get("fixo", 0)) == 1 and not coverage_emergency:
        fixed = emp.get("turno_fixo")
        if fixed and fixed != shift_code:
            return False, f"funcionário fixo no {fixed}"

    return True, ""

def employee_score(emp, day, shift_code, planned, fortnight_penalty=0):
    """Calcula a penalidade operacional de um piloto para o turno; menor pontuação ganha prioridade."""
    emp_id = int(emp["id"])
    score = fortnight_penalty

    total_work = total_work_for_employee(emp_id, planned)
    previous_streak = consecutive_work_count(emp_id, day, planned)

    score += total_work * 10
    score += shift_count_for_employee(emp_id, shift_code, planned) * 5

    prev_day = day - timedelta(days=1)
    prev_shift = planned.get((emp_id, prev_day))
    if prev_shift == shift_code:
        score -= 40
    elif prev_shift:
        score += 18

    if previous_streak in [1, 2, 3, 4, 5]:
        score -= 30 + previous_streak * 6
    elif previous_streak == 0:
        score += 8

    score += max(previous_streak - 5, 0) * 6

    role = str(emp.get("cargo", emp.get("role", ""))).upper()
    if role == "APAO":
        score += float(emp["senioridade"]) * 0.03
    else:
        score += float(emp["senioridade"]) * 0.1

    if int(emp.get("fixo", 0)) == 1 and emp.get("turno_fixo") == shift_code:
        score -= 50

    return score


def _pick_shift_candidate(employees, day, shift_code, blocked, planned, shift_map, shift_restrictions, max_monthly_work, strict, start_date, end_date, role=None, include_emergency=False):
    """Camadas 1–4: regras plenas → relaxadas → exceção de bloco → emergência cobertura."""
    attempts = [
        {"allow_fortnight_override": False, "strict_mode": True, "score_extra": 0, "tag": "", "coverage_emergency": False},
        {"allow_fortnight_override": False, "strict_mode": False, "score_extra": 1000, "tag": "", "coverage_emergency": False},
        {"allow_fortnight_override": True, "strict_mode": False, "score_extra": 600, "tag": "Exceção bloco", "coverage_emergency": False},
    ]
    if include_emergency:
        attempts.append({
            "allow_fortnight_override": True, "strict_mode": False, "score_extra": 8000,
            "tag": "Emergência cobertura", "coverage_emergency": True,
        })

    emp_lists = [employees]
    if role == "APAO":
        pass  # APAO isolado — substituição PAO via _backfill_pao_for_apao_gaps

    for pool in emp_lists:
        is_pao_fallback = pool is not emp_lists[0]
        for idx, attempt in enumerate(attempts):
            if idx == 1 and not strict:
                continue
            if idx == 1 and attempt["strict_mode"]:
                pass
            candidates = []
            for emp in pool:
                ok, _ = can_work(
                    emp, day, shift_code, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=attempt["strict_mode"],
                    allow_fortnight_override=attempt["allow_fortnight_override"],
                    coverage_emergency=attempt["coverage_emergency"],
                )
                if not ok:
                    continue
                if shift_code == "T8" and t8_previous_count(int(emp["id"]), day, planned) >= 2:
                    continue
                if role_for_shift(shift_code, shift_map) == "APAO" and str(emp.get("cargo", "")).upper().startswith("APAO"):
                    if consecutive_work_count(int(emp["id"]), day, planned) >= 6:
                        continue
                load = current_month_workload(int(emp["id"]), planned, blocked, start_date, end_date)
                fpen = attempt["score_extra"]
                sc = employee_score(emp, day, shift_code, planned, fortnight_penalty=fpen)
                candidates.append((load, sc, emp, attempt["tag"], is_pao_fallback))
            if candidates:
                candidates.sort(key=lambda x: (x[0], x[1], int(x[2].get("senioridade", 999))))
                return candidates[0]
    return None


def _repair_coverage_gaps(year, month, roles_to_generate, planned, blocked, created, log, shift_map, shift_restrictions, max_monthly_work, strict, start_date, end_date):
    """Camada 2: segunda passada preenche slots vazios priorizando qualidade."""
    repaired = 0
    for role in roles_to_generate:
        sh_df = shifts_df(role)
        emp_df = employees_df(role)
        if sh_df.empty or emp_df.empty:
            continue
        employees = _sort_by_seniority(emp_df.to_dict("records"))
        for day in iter_days(year, month):
            for shift in sh_df.to_dict("records"):
                shift_code = shift["codigo"]
                if shift_code == "ND":
                    continue
                need = int(shift["maximo"])
                have = sum(1 for (eid, d), sh in planned.items() if d == day and sh == shift_code)
                for _ in range(max(0, need - have)):
                    picked = _pick_by_seniority_cascade(
                        employees, day, shift_code, blocked, planned,
                        shift_map, shift_restrictions, max_monthly_work, strict,
                        start_date, end_date, role=role, include_emergency=True,
                    )
                    if not picked:
                        continue
                    _, _, chosen, tag, is_fallback = picked
                    emp_id = int(chosen["id"])
                    planned[(emp_id, day)] = shift_code
                    if is_fallback:
                        note = "Gerado automaticamente (Reparo — Fallback PAO em APAO)"
                        det = f"{chosen['nome']} — reparo {shift_code} (PAO cobrindo APAO)."
                        tipo = "REPARO FALLBACK"
                    elif tag:
                        note = f"Gerado automaticamente (Reparo — {tag})"
                        det = f"{chosen['nome']} — reparo {shift_code} ({tag})."
                        tipo = "REPARO QUINZENA"
                    else:
                        note = "Gerado automaticamente (Reparo de cobertura)"
                        det = f"{chosen['nome']} — reparo {shift_code}."
                        tipo = "REPARO"
                    created.append((str(day), shift_code, emp_id, note))
                    log.append({"tipo": tipo, "data": str(day), "cargo": role, "turno": shift_code, "detalhe": det})
                    repaired += 1
    if repaired:
        log.append({"tipo": "REPARO RESUMO", "data": "-", "cargo": "-", "turno": "-", "detalhe": f"Segunda passada preencheu {repaired} slot(s) vazio(s)."})
    return repaired


def _reload_planned_blocked(start_date, end_date):
    """Recarrega turnos e bloqueios do banco (inclui dia anterior para descanso 12h)."""
    prev_day = start_date - timedelta(days=1)
    planned = {}
    sched = schedule_df(prev_day, end_date)
    if not sched.empty:
        for _, r in sched.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    blocked = {}
    alloc = allocations_df(prev_day, end_date)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]
    return planned, blocked


def _is_clearable_auto_allocation(tipo, notes):
    """VOO/folga/ND automáticos podem ser removidos para fechar cobertura PAO."""
    if _is_protected_prealloc(tipo):
        return False
    n = str(notes or "")
    if _is_auto_generated_note(n):
        return True
    if n.startswith("Preenchimento"):
        return True
    return False


def _force_clear_auto_rests_on_day(emp_id, day, blocked, log) -> bool:
    """Remove folgas automáticas do dia para liberar cobertura inviolável."""
    from database.connection import query_df

    rows = query_df(
        "SELECT alloc_type, notes FROM allocations WHERE employee_id = ? AND alloc_date = ?",
        (int(emp_id), str(day)),
    )
    if rows.empty:
        return False
    tipo = str(rows.iloc[0]["alloc_type"]).upper()
    notes = str(rows.iloc[0]["notes"] or "")
    if tipo not in _AUTO_REST_TYPES and tipo != "ND":
        return False
    if tipo == "ND" and "Gerado automaticamente" not in notes:
        return False
    if not _is_clearable_auto_allocation(tipo, notes) and tipo != "ND":
        return False
    execute(
        "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ?",
        (int(emp_id), str(day)),
    )
    blocked.pop((int(emp_id), day), None)
    if log is not None:
        log.append({
            "tipo": "COBERTURA DESBLOQUEIO",
            "data": str(day),
            "cargo": "PAO",
            "turno": "-",
            "detalhe": f"Piloto {emp_id}: removido {tipo} automático para cobertura T6/T7/T8.",
        })
    return True


def _clear_clearable_allocation(emp_id, day, blocked):
    from database.connection import query_df

    rows = query_df(
        "SELECT alloc_type, notes FROM allocations WHERE employee_id = ? AND alloc_date = ?",
        (int(emp_id), str(day)),
    )
    if rows.empty:
        return False
    tipo = rows.iloc[0]["alloc_type"]
    notes = rows.iloc[0]["notes"]
    if not _is_clearable_auto_allocation(tipo, notes):
        return False
    execute(
        "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ?",
        (int(emp_id), str(day)),
    )
    blocked.pop((int(emp_id), day), None)
    return True


def _sort_by_seniority(employees):
    return sorted(employees, key=lambda e: int(e.get("senioridade", 999)))


def _seniority_levels(employees):
    return sorted({int(e.get("senioridade", 999)) for e in employees})


_AUTO_REST_TYPES = {
    "FOLGA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ESCOLHIDA", "FOLGA ANIVERSÁRIO",
}


def _employee_auto_rest_runs(emp_id, blocked, start_date, end_date):
    """Sequências consecutivas de folgas automáticas do funcionário no mês."""
    days = sorted(
        d for (eid, d), kind in blocked.items()
        if int(eid) == int(emp_id) and start_date <= d <= end_date
        and str(kind).upper() in _AUTO_REST_TYPES
    )
    return _consecutive_runs(days)


def _compact_rest_runs_for_employee(emp, year, month, planned, blocked, log, min_len=1):
    """
    Reduz blocos longos de folga automática (5→4→3→2→1) liberando dias para turno.
    """
    emp_id = int(emp["id"])
    nome = emp.get("nome", "")
    start_date, end_date = month_range(year, month)
    runs = _employee_auto_rest_runs(emp_id, blocked, start_date, end_date)
    if not runs:
        return False

    for run in sorted(runs, key=len, reverse=True):
        if len(run) <= min_len:
            continue
        for target_len in range(len(run) - 1, min_len - 1, -1):
            to_release = run[target_len:]
            released = []
            for d in to_release:
                if _clear_clearable_allocation(emp_id, d, blocked):
                    released.append(d)
            if released:
                log.append({
                    "tipo": "FOLGA RECompact",
                    "data": f"{released[0]}…{released[-1]}" if len(released) > 1 else str(released[0]),
                    "cargo": str(emp.get("cargo", "PAO")),
                    "turno": "-",
                    "detalhe": (
                        f"{nome}: folga automática reduzida de {len(run)}→{target_len} dia(s) "
                        f"({len(released)} liberado(s)) para permitir turno."
                    ),
                })
                return True
    return False


def _compact_rest_runs_for_all(employees, year, month, planned, blocked, log, min_len=1):
    """Compacta folgas longas de todos os funcionários (senioridade 1→N)."""
    changed = 0
    for emp in _sort_by_seniority(employees):
        if _compact_rest_runs_for_employee(emp, year, month, planned, blocked, log, min_len=min_len):
            changed += 1
    return changed


def _open_coverage_slots(schedule_days, shifts, planned):
    """Lista (dia, turno) ainda sem cobertura."""
    slots = []
    for day in schedule_days:
        for shift in shifts:
            code = shift["codigo"]
            if code == "ND":
                continue
            need = int(shift["maximo"])
            have = sum(1 for (_eid, d), sh in planned.items() if d == day and sh == code)
            for _ in range(max(0, need - have)):
                slots.append((day, code))
    return slots


def _employee_t8_eligible(emp, shift_restrictions):
    emp_id = int(emp["id"])
    if shift_restrictions and "T8" in shift_restrictions.get(emp_id, set()):
        return False
    is_fixed = int(emp.get("fixo", 0) or 0) == 1
    fixed_shift = str(emp.get("turno_fixo") or "").upper().strip()
    if is_fixed and fixed_shift and fixed_shift != "T8":
        return False
    return True


def _allocate_t8_primary_by_seniority(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, max_monthly_work,
):
    """T8 primeiro: cada piloto elegível (sen. 1→N) recebe bloco T8/T8/ND antes de T6/T7."""
    from core.t8_planner import _place_t8_block, day_needs_t8, _pilot_can_host_block

    days = list(iter_days(year, month))
    start_date, end_date = month_range(year, month)
    employees = _sort_by_seniority([
        e for e in employees_df("PAO").to_dict("records")
        if is_employee_planning_active_month(int(e["id"]), year, month)
    ])
    if not employees:
        return

    log.append({
        "tipo": "FASE T8 PRIMÁRIO",
        "data": "-", "cargo": "PAO", "turno": "T8",
        "detalhe": "T8 por senioridade 1→N (bloco T8/T8/ND antes de T6/T7).",
    })

    for emp in employees:
        if not _employee_t8_eligible(emp, shift_restrictions):
            continue
        emp_id = int(emp["id"])
        if _count_t8_blocks(emp_id, planned, blocked, days) >= 1:
            continue

        _compact_rest_runs_for_employee(emp, year, month, planned, blocked, log, min_len=1)

        placed = False
        for i in range(len(days) - 2):
            d1, d2, d3 = days[i], days[i + 1], days[i + 2]
            if not day_needs_t8(planned, d1) and not day_needs_t8(planned, d2):
                if planned.get((emp_id, d1)) or planned.get((emp_id, d2)):
                    continue
            for strict, override in ((True, False), (False, False), (False, True)):
                if _pilot_can_host_block(
                    emp, d1, d2, d3, blocked, planned,
                    shift_map, shift_restrictions, max_monthly_work,
                    strict=strict, allow_fortnight_override=override,
                ):
                    _place_t8_block(
                        emp, d1, d2, d3, planned, blocked, created, log,
                        f"T8 primário sen.{emp.get('senioridade', '?')}",
                    )
                    placed = True
                    break
            if placed:
                break
        if not placed:
            work = sum(1 for (eid, d), sh in planned.items() if int(eid) == emp_id and sh)
            if work == 0:
                _compact_rest_runs_for_employee(emp, year, month, planned, blocked, log, min_len=0)


def _assign_slot_to_employee(
    emp, day, shift_code, year, month, planned, blocked, created, log,
    role, manual_keys, note_prefix="",
):
    emp_id = int(emp["id"])
    planned[(emp_id, day)] = shift_code
    note = f"Gerado automaticamente ({note_prefix}sen.{emp.get('senioridade', '?')})"
    created.append((str(day), shift_code, emp_id, note))
    log.append({
        "tipo": "ALOCADO",
        "data": str(day),
        "cargo": role,
        "turno": shift_code,
        "detalhe": f"{emp.get('nome', '')} — turno aberto ({note_prefix}sen.{emp.get('senioridade', '?')}).",
    })
    _schedule_rest_if_six_complete(
        emp_id, day, year, month, planned, blocked, manual_keys, log,
        emp_nome=emp.get("nome", ""),
    )
    return True


def _run_seniority_round_robin_slots(
    year, month, employees, shifts, planned, blocked, created, log,
    shift_map, shift_restrictions, max_monthly_work, strict,
    start_date, end_date, schedule_days, role,
):
    """
    Senioridade 1 pega próximo turno aberto, depois 2, 3… — cicla até esgotar slots.
    Compacta folgas longas antes e durante se piloto ficar sem turno.
    """
    employees = _sort_by_seniority(employees)
    manual_keys = _manual_assignment_keys(start_date, end_date)
    _compact_rest_runs_for_all(employees, year, month, planned, blocked, log, min_len=1)

    slots = _open_coverage_slots(schedule_days, shifts, planned)
    if not slots:
        return

    max_rounds = len(slots) * max(len(employees), 1) * 3
    rounds = 0
    while slots and rounds < max_rounds:
        rounds += 1
        progress = False
        for emp in employees:
            if not slots:
                break
            emp_id = int(emp["id"])
            if not is_employee_planning_active_month(emp_id, year, month):
                continue

            work_count = sum(
                1 for (eid, d), sh in planned.items()
                if int(eid) == emp_id and sh and start_date <= d <= end_date
            )
            if work_count == 0:
                _compact_rest_runs_for_employee(emp, year, month, planned, blocked, log, min_len=1)

            assigned = False
            if role == "APAO":
                pref = _apao_preferred_shifts(emp, shifts, shift_restrictions)
            else:
                pref = _shift_codes_for_employee(emp, role)
                restricted = shift_restrictions.get(emp_id, set()) if shift_restrictions else set()
                pref = [s for s in pref if s not in restricted and s != "T8"] or ["T6", "T7"]

            slot_order = sorted(
                range(len(slots)),
                key=lambda i: (0 if slots[i][1] in pref else 1, slots[i][0], i),
            )
            for idx in slot_order:
                day, shift_code = slots[idx]
                ok, _ = can_work(
                    emp, day, shift_code, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=strict,
                )
                if not ok:
                    continue
                _assign_slot_to_employee(
                    emp, day, shift_code, year, month, planned, blocked, created, log,
                    role, manual_keys, note_prefix=f"{role} ",
                )
                slots.pop(idx)
                progress = True
                assigned = True
                break

            if not assigned and work_count == 0:
                if _compact_rest_runs_for_employee(emp, year, month, planned, blocked, log, min_len=0):
                    for idx, (day, shift_code) in enumerate(slots):
                        ok, _ = can_work(
                            emp, day, shift_code, blocked, planned,
                            shift_map=shift_map, shift_restrictions=shift_restrictions,
                            max_monthly_work=max_monthly_work, strict=False,
                            allow_fortnight_override=True,
                        )
                        if ok:
                            _assign_slot_to_employee(
                                emp, day, shift_code, year, month, planned, blocked, created, log,
                                role, manual_keys, note_prefix=f"{role} recompact ",
                            )
                            slots.pop(idx)
                            progress = True
                            break

        if not progress:
            break

    for day, shift_code in slots:
        log.append({
            "tipo": "SEM COBERTURA",
            "data": str(day),
            "cargo": role,
            "turno": shift_code,
            "detalhe": f"Turno aberto sem candidato (round-robin sen. esgotado).",
        })


def _employee_day_is_blank(emp_id, day, planned, blocked):
    return not planned.get((emp_id, day)) and not blocked.get((emp_id, day))


def _pick_by_seniority_cascade(
    employees, day, shift_code, blocked, planned,
    shift_map, shift_restrictions, max_monthly_work, strict,
    start_date, end_date, role=None, include_emergency=False,
):
    """Escolhe candidato testando senioridade 1, depois 2, 3…"""
    sorted_emps = _sort_by_seniority(employees)
    for sen in _seniority_levels(sorted_emps):
        pool = [e for e in sorted_emps if int(e.get("senioridade", 999)) == sen]
        picked = _pick_shift_candidate(
            pool, day, shift_code, blocked, planned,
            shift_map, shift_restrictions, max_monthly_work, strict,
            start_date, end_date, role=role, include_emergency=False,
        )
        if picked:
            return picked
    if include_emergency:
        return _pick_shift_candidate(
            sorted_emps, day, shift_code, blocked, planned,
            shift_map, shift_restrictions, max_monthly_work, False,
            start_date, end_date, role=role, include_emergency=True,
        )
    # Relaxação sem violar folgas: strict=False, exceção de bloco quinzena
    picked = _pick_shift_candidate(
        sorted_emps, day, shift_code, blocked, planned,
        shift_map, shift_restrictions, max_monthly_work, False,
        start_date, end_date, role=role, include_emergency=False,
    )
    if picked:
        return picked
    return None


def _apao_preferred_shifts(emp, shifts, shift_restrictions):
    emp_id = int(emp["id"])
    restricted = shift_restrictions.get(emp_id, set()) if shift_restrictions else set()
    if int(emp.get("fixo", 0) or 0) == 1 and emp.get("turno_fixo"):
        codes = [str(emp.get("turno_fixo")).strip()]
    else:
        codes = [s["codigo"] for s in shifts if s["codigo"] != "ND"]
    codes = [c for c in codes if c not in restricted]
    if codes:
        return codes
    return [s["codigo"] for s in shifts if s["codigo"] != "ND"]


def _fill_role_blank_with_voo(emp, day, blocked, log, role_label="APAO"):
    emp_id = int(emp["id"])
    nome = emp.get("nome", "")
    add_allocation(emp_id, day, "VOO", f"Gerado automaticamente (preenche célula {role_label})")
    blocked[(emp_id, day)] = "VOO"
    log.append({
        "tipo": f"VOO {role_label}",
        "data": str(day),
        "cargo": role_label,
        "turno": "-",
        "detalhe": f"{nome}: VOO para evitar dia em branco.",
    })
    return True


def _run_apao_allocation_phase(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, max_monthly_work, strict,
    start_date, end_date, schedule_days,
):
    """Fase 1: APAO — compacta folgas, round-robin sen. 1→N nos turnos abertos."""
    emp_df = employees_df("APAO")
    sh_df = shifts_df("APAO")
    if emp_df.empty or sh_df.empty:
        return

    employees = _sort_by_seniority(emp_df.to_dict("records"))
    shifts = sh_df.to_dict("records")

    log.append({
        "tipo": "FASE APAO",
        "data": "-", "cargo": "APAO", "turno": "-",
        "detalhe": "APAO: compactar folgas → round-robin sen. 1→N nos turnos abertos.",
    })

    _run_seniority_round_robin_slots(
        year, month, employees, shifts, planned, blocked, created, log,
        shift_map, shift_restrictions, max_monthly_work, strict,
        start_date, end_date, schedule_days, role="APAO",
    )

    manual_keys = _manual_assignment_keys(start_date, end_date)
    for emp in employees:
        emp_id = int(emp["id"])
        if not is_employee_planning_active_month(emp_id, year, month):
            continue
        pref_shifts = _apao_preferred_shifts(emp, shifts, shift_restrictions)
        for day in iter_days(year, month):
            if is_employee_on_vacation(emp_id, day):
                continue
            if not _employee_day_is_blank(emp_id, day, planned, blocked):
                continue
            assigned = False
            for shift_code in pref_shifts:
                ok, _ = can_work(
                    emp, day, shift_code, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=strict,
                )
                if not ok:
                    continue
                planned[(emp_id, day)] = shift_code
                created.append((str(day), shift_code, emp_id, "Gerado automaticamente (APAO preenche vazio)"))
                log.append({
                    "tipo": "APAO PREENCHE",
                    "data": str(day), "cargo": "APAO", "turno": shift_code,
                    "detalhe": f"{emp['nome']}: turno preferido preencheu dia vazio.",
                })
                _schedule_rest_if_six_complete(
                    emp_id, day, year, month, planned, blocked, manual_keys, log,
                    emp_nome=emp.get("nome", ""),
                )
                assigned = True
                break
            if not assigned:
                for shift in shifts:
                    sc = shift["codigo"]
                    if sc == "ND":
                        continue
                    ok, _ = can_work(
                        emp, day, sc, blocked, planned,
                        shift_map=shift_map, shift_restrictions=shift_restrictions,
                        max_monthly_work=max_monthly_work, strict=False,
                        allow_fortnight_override=True,
                    )
                    if ok:
                        planned[(emp_id, day)] = sc
                        created.append((str(day), sc, emp_id, "Gerado automaticamente (APAO fallback)"))
                        log.append({
                            "tipo": "APAO PREENCHE",
                            "data": str(day), "cargo": "APAO", "turno": sc,
                            "detalhe": f"{emp['nome']}: turno alternativo preencheu dia vazio.",
                        })
                        assigned = True
                        break
            if not assigned and _employee_day_is_blank(emp_id, day, planned, blocked):
                _fill_role_blank_with_voo(emp, day, blocked, log, "APAO")


def _run_pao_seniority_allocation_phase(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, max_monthly_work, strict,
    start_date, end_date, schedule_days,
):
    """Fase PAO: T8 já alocado → round-robin T6/T7 sen. 1→N + preenchimento de vazios."""
    emp_df = employees_df("PAO")
    sh_df = shifts_df("PAO")
    if emp_df.empty:
        return

    employees = _sort_by_seniority(emp_df.to_dict("records"))
    shifts = [s for s in sh_df.to_dict("records") if s["codigo"] != "T8"] if not sh_df.empty else []
    manual_keys = _manual_assignment_keys(start_date, end_date)

    log.append({
        "tipo": "FASE PAO",
        "data": "-", "cargo": "PAO", "turno": "-",
        "detalhe": "PAO: round-robin sen. 1→N nos turnos T6/T7 abertos.",
    })

    _run_seniority_round_robin_slots(
        year, month, employees, shifts, planned, blocked, created, log,
        shift_map, shift_restrictions, max_monthly_work, strict,
        start_date, end_date, schedule_days, role="PAO",
    )

    for emp in employees:
        emp_id = int(emp["id"])
        if not is_employee_planning_active_month(emp_id, year, month):
            continue
        pref_shifts = _shift_codes_for_employee(emp, "PAO")
        restricted = shift_restrictions.get(emp_id, set()) if shift_restrictions else set()
        pref_shifts = [s for s in pref_shifts if s not in restricted and s != "T8"] or ["T6", "T7"]
        for day in iter_days(year, month):
            if is_employee_on_vacation(emp_id, day):
                continue
            if not _employee_day_is_blank(emp_id, day, planned, blocked):
                continue
            if day in _pilot_off_block_days(emp_id, year, month, include_fixed=False):
                if employee_can_receive_flight(emp, day):
                    _fill_role_blank_with_voo(emp, day, blocked, log, "PAO")
                continue
            assigned = False
            for shift_code in pref_shifts:
                ok, _ = can_work(
                    emp, day, shift_code, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=strict,
                )
                if ok:
                    planned[(emp_id, day)] = shift_code
                    created.append((str(day), shift_code, emp_id, "Gerado automaticamente (PAO preenche vazio)"))
                    log.append({
                        "tipo": "PAO PREENCHE",
                        "data": str(day), "cargo": "PAO", "turno": shift_code,
                        "detalhe": f"{emp['nome']}: preencheu dia vazio (sen.{emp.get('senioridade', '?')}).",
                    })
                    _schedule_rest_if_six_complete(
                        emp_id, day, year, month, planned, blocked, manual_keys, log,
                        emp_nome=emp.get("nome", ""),
                    )
                    assigned = True
                    break
            if not assigned and employee_can_receive_flight(emp, day):
                _fill_role_blank_with_voo(emp, day, blocked, log, "PAO")


def _run_pao_fcf_seniority_fill(
    year, month, planned, blocked, log, start_date, end_date,
):
    """Preenche dias vazios PAO FCF por senioridade com VOO quando não há turno."""
    emp_df = employees_df("PAO FCF")
    if emp_df.empty:
        return
    for emp in _sort_by_seniority(emp_df.to_dict("records")):
        emp_id = int(emp["id"])
        if not is_employee_planning_active_month(emp_id, year, month):
            continue
        for day in iter_days(year, month):
            if is_employee_on_vacation(emp_id, day):
                continue
            if not _employee_day_is_blank(emp_id, day, planned, blocked):
                continue
            if employee_can_receive_flight(emp, day):
                _fill_role_blank_with_voo(emp, day, blocked, log, "PAO FCF")


def _sweep_remaining_blank_days(year, month, roles_to_generate, log):
    """Varredura final: VOO em células ainda vazias (APAO → PAO → PAO FCF, senioridade 1→N)."""
    start_date, end_date = month_range(year, month)
    order = ["APAO", "PAO", "PAO FCF"]
    filled = 0
    for role in order:
        if role not in roles_to_generate:
            continue
        emp_df = employees_df(role)
        if emp_df.empty:
            continue
        planned, blocked = _reload_planned_blocked(start_date, end_date)
        for emp in _sort_by_seniority(emp_df.to_dict("records")):
            emp_id = int(emp["id"])
            if not is_employee_planning_active_month(emp_id, year, month):
                continue
            for day in iter_days(year, month):
                if is_employee_on_vacation(emp_id, day):
                    continue
                if not _employee_day_is_blank(emp_id, day, planned, blocked):
                    continue
                if employee_can_receive_flight(emp, day):
                    _fill_role_blank_with_voo(emp, day, blocked, log, role)
                    filled += 1
                    planned, blocked = _reload_planned_blocked(start_date, end_date)
    if filled:
        log.append({
            "tipo": "VARREDURA VAZIOS",
            "data": "-", "cargo": "-", "turno": "-",
            "detalhe": f"Varredura final preencheu {filled} célula(s) vazia(s) com VOO.",
        })
    return filled


def _pao_count_on_shift(planned, day, shift_code, role_map):
    return sum(
        1 for (eid, d), sh in planned.items()
        if d == day and sh == shift_code and str(role_map.get(int(eid), "")) == "PAO"
    )


def _backfill_pao_for_apao_gaps(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, max_monthly_work, strict,
    start_date, end_date,
):
    """Se faltar APAO no dia, aloca PAO extra (até 2 no mesmo turno PAO)."""
    from core.rules import build_employee_role_map

    role_map = build_employee_role_map()
    emp_df = employees_df("PAO")
    if emp_df.empty:
        return 0
    employees = _sort_by_seniority(emp_df.to_dict("records"))
    added = 0

    for day in iter_days(year, month):
        while apao_shortfall_on_day(day, planned, role_map) > 0:
            placed = False
            for shift_code in ("T6", "T7", "T8"):
                cap = pao_shift_capacity_on_day(day, shift_code, planned, role_map, apao_substitute=True)
                if _pao_count_on_shift(planned, day, shift_code, role_map) >= cap:
                    continue
                picked = _pick_shift_candidate(
                    employees, day, shift_code, blocked, planned,
                    shift_map, shift_restrictions, max_monthly_work, strict,
                    start_date, end_date, role="PAO", include_emergency=True,
                )
                if not picked:
                    continue
                _, _, chosen, tag, _ = picked
                emp_id = int(chosen["id"])
                planned[(emp_id, day)] = shift_code
                note = "Gerado automaticamente (PAO extra — substitui APAO ausente)"
                det = f"{chosen['nome']} no {shift_code} (cobertura dupla PAO por falta de APAO)."
                if tag:
                    det += f" [{tag}]"
                created.append((str(day), shift_code, emp_id, note))
                log.append({
                    "tipo": "PAO SUBSTITUI APAO",
                    "data": str(day),
                    "cargo": "PAO",
                    "turno": shift_code,
                    "detalhe": det,
                })
                added += 1
                placed = True
                break
            if not placed:
                break
    return added


def _count_pao_coverage_issues(planned, day, role_map=None):
    """Retorna (faltantes, superposições) para T6/T7/T8 num dia."""
    from core.rules import build_employee_role_map

    if role_map is None:
        role_map = build_employee_role_map()
    missing = []
    overlaps = 0
    apao_gap = apao_shortfall_on_day(day, planned, role_map)
    for shift_code in ("T6", "T7", "T8"):
        have = [
            eid for (eid, d), sh in planned.items()
            if d == day and sh == shift_code and str(role_map.get(int(eid), "")) == "PAO"
        ]
        cap = pao_shift_capacity_on_day(day, shift_code, planned, role_map, apao_substitute=apao_gap > 0)
        if not have:
            missing.append(shift_code)
        elif len(have) > cap:
            overlaps += len(have) - cap
    return missing, overlaps


def _fix_pao_shift_duplicates(year, month, planned, blocked, log):
    """Move PAO duplicado no mesmo turno para slot vazio — preserva dupla PAO se faltar APAO."""
    from core.rules import build_employee_role_map

    role_map = build_employee_role_map()
    fixed = 0
    for day in iter_days(year, month):
        if apao_shortfall_on_day(day, planned, role_map) > 0:
            continue
        missing, _ = _count_pao_coverage_issues(planned, day, role_map)
        for shift_code in ("T6", "T7", "T8"):
            occupants = [eid for (eid, d), sh in planned.items() if d == day and sh == shift_code]
            while len(occupants) > 1:
                extra_id = occupants.pop()
                target_shift = missing[0] if missing else None
                if not target_shift:
                    execute(
                        "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
                        (int(extra_id), str(day)),
                    )
                    planned.pop((extra_id, day), None)
                    log.append({
                        "tipo": "COBERTURA DUP",
                        "data": str(day),
                        "cargo": "PAO",
                        "turno": shift_code,
                        "detalhe": f"Removida superposição extra em {shift_code} (sem slot livre).",
                    })
                    fixed += 1
                    continue

                emp_df = employees_df("PAO")
                emp_row = emp_df[emp_df["id"] == int(extra_id)]
                if emp_row.empty:
                    break
                emp = emp_row.iloc[0].to_dict()
                shift_map = build_shift_time_map()
                shift_restrictions = build_shift_restriction_map(year, month)
                planned.pop((extra_id, day), None)
                ok, reason = can_work(
                    emp, day, target_shift, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    strict=False, allow_fortnight_override=True, coverage_emergency=True,
                )
                if not ok:
                    planned[(extra_id, day)] = shift_code
                    execute(
                        "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
                        (int(extra_id), str(day)),
                    )
                    planned.pop((extra_id, day), None)
                    log.append({
                        "tipo": "COBERTURA DUP",
                        "data": str(day),
                        "cargo": "PAO",
                        "turno": shift_code,
                        "detalhe": f"Removida superposição em {shift_code}; não coube em {target_shift}: {reason}.",
                    })
                    fixed += 1
                    continue

                execute(
                    "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
                    (int(extra_id), str(day)),
                )
                note = f"Gerado automaticamente (Cobertura final — realocado de {shift_code} para {target_shift})"
                add_assignment(str(day), target_shift, int(extra_id), note)
                planned[(extra_id, day)] = target_shift
                missing.pop(0)
                log.append({
                    "tipo": "COBERTURA DUP",
                    "data": str(day),
                    "cargo": "PAO",
                    "turno": target_shift,
                    "detalhe": f"{emp['nome']} movido de {shift_code} para {target_shift}.",
                })
                fixed += 1
    return fixed


def force_close_pao_coverage(year, month, day_order=None, max_passes=6):
    """
    Passagem final: corrige superposições e preenche T6/T7/T8 faltantes.
    Pode remover VOO/folga automáticos (nunca L/K/FP) para fechar furos.
    """
    start_date, end_date = month_range(year, month)
    shift_map = build_shift_time_map()
    shift_restrictions = build_shift_restriction_map(year, month)
    emp_df = employees_df("PAO")
    if emp_df.empty:
        return {"fixed": 0, "remaining": 0, "log": []}

    employees = _sort_by_seniority(emp_df.to_dict("records"))
    schedule_days = day_order if day_order else list(iter_days(year, month))
    log = []
    total_fixed = 0

    for _pass in range(max_passes):
        planned, blocked = _reload_planned_blocked(start_date, end_date)
        dup_fixed = _fix_pao_shift_duplicates(year, month, planned, blocked, log)
        total_fixed += dup_fixed
        pass_fixed = 0

        for day in schedule_days:
            missing, _ = _count_pao_coverage_issues(planned, day)
            for shift_code in missing:
                if shift_code == "T8":
                    from core.t8_planner import try_close_t8_gap
                    if try_close_t8_gap(
                        day, year, month, planned, blocked,
                        shift_map, shift_restrictions, None,
                        start_date, end_date, log,
                    ):
                        if not _count_pao_coverage_issues(planned, day)[0]:
                            pass_fixed += 1
                            total_fixed += 1
                    continue

                picked = None
                cleared_for = None

                picked = _pick_by_seniority_cascade(
                    employees, day, shift_code, blocked, planned,
                    shift_map, shift_restrictions, None, False,
                    start_date, end_date, role="PAO", include_emergency=True,
                )

                if not picked:
                    ranked = _sort_by_seniority(employees)
                    for emp in ranked:
                        eid = int(emp["id"])
                        if (eid, day) in planned:
                            continue
                        if not _clear_clearable_allocation(eid, day, blocked):
                            continue
                        cleared_for = eid
                        picked = _pick_by_seniority_cascade(
                            employees, day, shift_code, blocked, planned,
                            shift_map, shift_restrictions, None, False,
                            start_date, end_date, role="PAO", include_emergency=True,
                        )
                        if picked:
                            break

                if not picked:
                    continue

                _, _, chosen, tag, _ = picked
                emp_id = int(chosen["id"])
                parts = ["Cobertura final"]
                if tag:
                    parts.append(tag)
                if cleared_for is not None and cleared_for == emp_id:
                    parts.append("desbloqueio auto")
                note = f"Gerado automaticamente ({' — '.join(parts)})"
                planned[(emp_id, day)] = shift_code
                add_assignment(str(day), shift_code, emp_id, note)
                det = f"{chosen['nome']} — {shift_code} ({', '.join(parts)})."
                log.append({
                    "tipo": "COBERTURA FINAL",
                    "data": str(day),
                    "cargo": "PAO",
                    "turno": shift_code,
                    "detalhe": det,
                })
                pass_fixed += 1
                total_fixed += 1

        if pass_fixed == 0 and dup_fixed == 0:
            break

    planned, _ = _reload_planned_blocked(start_date, end_date)
    remaining = 0
    for day in iter_days(year, month):
        missing, overlaps = _count_pao_coverage_issues(planned, day)
        remaining += len(missing) + overlaps

    if total_fixed:
        log.append({
            "tipo": "COBERTURA RESUMO",
            "data": "-",
            "cargo": "PAO",
            "turno": "-",
            "detalhe": f"Fechamento final: {total_fixed} correção(ões); furos restantes: {remaining}.",
        })

    return {"fixed": total_fixed, "remaining": remaining, "log": log}


def current_month_workload(emp_id, planned, blocked, start_date, end_date):
    """Calcula a carga de trabalho do piloto no mês de competência (turnos ativos + voos/simuladores/cursos)."""
    shifts_count = sum(
        1 for (eid, d), sh in planned.items()
        if int(eid) == int(emp_id) and sh and start_date <= d <= end_date and sh not in ["ND", "FOLGA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO"]
    )
    active_blocks = sum(
        1 for (eid, d), kind in blocked.items()
        if int(eid) == int(emp_id) and str(kind).upper() in ["SIMULADOR", "CURSO ONLINE", "VOO"] and start_date <= d <= end_date
    )
    return shifts_count + active_blocks

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

        for idx, emp in enumerate(_sort_by_seniority(emp_df.to_dict("records"))):
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

    start_date, end_date = month_range(year, month)
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
            if _count_t8_blocks(emp_id, planned, blocked, days) >= 2:
                continue

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

            load = current_month_workload(emp_id, planned, blocked, start_date, end_date)
            t8_penalty = _count_t8_blocks(emp_id, planned, blocked, days) * 80
            score = employee_score(emp, day1, "T8", planned) + t8_penalty
            candidates.append((load, score, emp))

        if not candidates:
            for emp in employees:
                emp_id = int(emp["id"])
                if _count_t8_blocks(emp_id, planned, blocked, days) >= 2:
                    continue
                for override in (False, True):
                    ok1, _ = can_work(
                        emp, day1, "T8", blocked, planned,
                        shift_map=shift_map, shift_restrictions=shift_restrictions,
                        max_monthly_work=max_monthly_work, strict=False,
                        allow_fortnight_override=override,
                    )
                    if not ok1:
                        continue
                    temp_planned = dict(planned)
                    temp_planned[(emp_id, day1)] = "T8"
                    ok2, _ = can_work(
                        emp, day2, "T8", blocked, temp_planned,
                        shift_map=shift_map, shift_restrictions=shift_restrictions,
                        max_monthly_work=max_monthly_work, strict=False,
                        allow_fortnight_override=override,
                    )
                    if not ok2:
                        continue
                    if day3 is not None and ((emp_id, day3) in blocked or temp_planned.get((emp_id, day3))):
                        continue
                    load = current_month_workload(emp_id, planned, blocked, start_date, end_date)
                    fpen = 600 if override else 1000
                    score = employee_score(emp, day1, "T8", planned, fortnight_penalty=fpen)
                    candidates.append((load, score, emp))
                    break

        if not candidates:
            log.append({
                "tipo": "T8 SEM COBERTURA",
                "data": str(day1),
                "cargo": "PAO",
                "turno": "T8",
                "detalhe": "Não foi encontrado PAO disponível para iniciar bloco T8,T8,ND neste dia."
            })
            continue

        candidates.sort(key=lambda x: (x[0], x[1]))
        chosen = candidates[0][2]
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

    # Remocao nao destrutiva das alocacoes de VOO deletadas
    emp_ids_to_clear = set(employees_df("PAO")["id"].astype(int).tolist()) if not employees_df("PAO").empty else set()
    keys_to_remove = [
        (eid, d) for (eid, d) in blocked
        if eid in emp_ids_to_clear and start_date <= d <= end_date and blocked[(eid, d)] == "VOO"
    ]
    for k in keys_to_remove:
        del blocked[k]

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

    # Remocao nao destrutiva das alocacoes de FOLGA deletadas
    emp_ids_to_clear = set()
    for role in roles_to_generate:
        df_role = employees_df(role)
        if not df_role.empty:
            emp_ids_to_clear.update(df_role["id"].astype(int).tolist())
    keys_to_remove = [
        (eid, d) for (eid, d) in blocked
        if eid in emp_ids_to_clear and start_date <= d <= end_date and blocked[(eid, d)] == "FOLGA"
    ]
    for k in keys_to_remove:
        del blocked[k]

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

def generate_auto_schedule(
    year, month, roles_to_generate, clear_existing=True, strict=True,
    max_monthly_work=None, target_rests=None, day_order=None, shifts_only=False,
):
    """Motor de escala automática. Realiza a alocação de turnos conforme pesos e critérios operacionais."""
    start_date, end_date = month_range(year, month)
    schedule_days = day_order if day_order else list(iter_days(year, month))
    lookback_start = start_date - timedelta(days=5)

    if clear_existing:
        backup_db("antes_gerar_escala")
        placeholders = ",".join(["?"] * len(roles_to_generate))
        execute(f"""
            DELETE FROM assignments
            WHERE work_date BETWEEN ? AND ?
            AND (notes LIKE 'Gerado automaticamente%' OR notes LIKE 'Ajustado automaticamente%')
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

    all_existing = schedule_df(lookback_start, end_date)
    planned = {}
    if not all_existing.empty:
        for _, r in all_existing.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    alloc = allocations_df(lookback_start, end_date)
    blocked = {}
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    shift_map = build_shift_time_map()
    shift_restrictions = build_shift_restriction_map(year, month)

    log = []
    created = []

    # ── PRIMEIRO PASSO: 6x1 carryover (últimos 5 dias do mês anterior) ──
    from core.coverage_gate import enforce_month_start_6x1_from_previous

    carry_roles = tuple(r for r in ("PAO", "APAO") if r in roles_to_generate)
    if carry_roles:
        enforce_month_start_6x1_from_previous(
            year, month, planned, blocked, log, roles=carry_roles,
        )
        alloc = allocations_df(lookback_start, end_date)
        blocked = {}
        if not alloc.empty:
            for _, r in alloc.iterrows():
                blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    # Folgas agrupadas/VOO só após cobertura 100% (shifts_only=True no v2)

    # ── FASE 1: APAO primeiro ──
    if "APAO" in roles_to_generate:
        _run_apao_allocation_phase(
            year, month, planned, blocked, created, log,
            shift_map, shift_restrictions, max_monthly_work, strict,
            start_date, end_date, schedule_days,
        )

    # Turnos fixos PAO (senioridade 1→N; T8 só via motor único)
    all_emp_df = employees_df()
    if not all_emp_df.empty and "PAO" in roles_to_generate:
        manual_keys = _manual_assignment_keys(start_date, end_date)
        fixed_employees = all_emp_df[
            (all_emp_df["fixo"] == 1) & (all_emp_df["cargo"] == "PAO")
        ].sort_values("senioridade")
        for _, emp in fixed_employees.iterrows():
            emp_id = int(emp["id"])
            pref_shift = emp.get("turno_fixo")
            if not pref_shift:
                continue
            if str(pref_shift).upper().strip() == "T8":
                continue  # T8 só via motor único (blocos T8/T8/ND)
            shift_win = _pilot_shift_block_days(emp_id, year, month, include_fixed=True)
            for d in iter_days(year, month):
                if d not in shift_win:
                    continue
                if (emp_id, d) in planned:
                    continue
                streak = consecutive_work_count(emp_id, d, planned)
                if not shifts_only and streak >= 4:
                    if (emp_id, d) not in blocked and (emp_id, d) not in manual_keys:
                        if not _is_protected_prealloc(blocked.get((emp_id, d))):
                            add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente (Folga turno fixo — par)")
                            blocked[(emp_id, d)] = "FOLGA"
                            log.append({
                                "tipo": "FOLGA 6X1", "data": str(d), "cargo": "PAO", "turno": "-",
                                "detalhe": f"{emp['nome']}: folga após 4 turnos (estilo planilha).",
                            })
                    d2 = d + timedelta(days=1)
                    if d2 <= end_date and (emp_id, d2) not in planned and (emp_id, d2) not in manual_keys:
                        if (emp_id, d2) not in blocked and not _is_protected_prealloc(blocked.get((emp_id, d2))):
                            add_allocation(emp_id, d2, "FOLGA", "Gerado automaticamente (Folga turno fixo — par)")
                            blocked[(emp_id, d2)] = "FOLGA"
                    continue
                if (emp_id, d) in blocked:
                    continue
                ok, _ = can_work(
                    emp.to_dict(), d, pref_shift, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=max_monthly_work, strict=strict,
                )
                if not ok:
                    continue
                planned[(emp_id, d)] = pref_shift
                created.append((str(d), pref_shift, emp_id, "Gerado automaticamente (Turno Fixo)"))
                if not shifts_only:
                    _schedule_rest_if_six_complete(
                        emp_id, d, year, month, planned, blocked, manual_keys, log, emp_nome=emp["nome"],
                    )

    # ── FASE 2: T8 primário por senioridade, depois cobertura T8 restante ──
    if "PAO" in roles_to_generate:
        _allocate_t8_primary_by_seniority(
            year, month, planned, blocked, created, log,
            shift_map, shift_restrictions, max_monthly_work,
        )
        from core.t8_planner import automated_plan_t8_coverage
        automated_plan_t8_coverage(
            year, month, planned, blocked, created, log,
            shift_map, shift_restrictions=shift_restrictions,
            max_monthly_work=max_monthly_work,
        )

    if "PAO FCF" in roles_to_generate:
        _run_pao_fcf_daily_coverage(
            year, month, planned, blocked, created, log,
            shift_map, shift_restrictions, start_date, end_date,
        )
        _run_pao_fcf_seniority_fill(year, month, planned, blocked, log, start_date, end_date)

    # ── FASE 3: PAO por senioridade 1→N (T6/T7 + preenchimento) ──
    if "PAO" in roles_to_generate:
        _run_pao_seniority_allocation_phase(
            year, month, planned, blocked, created, log,
            shift_map, shift_restrictions, max_monthly_work, strict,
            start_date, end_date, schedule_days,
        )

    _repair_coverage_gaps(
        year, month, roles_to_generate, planned, blocked, created, log,
        shift_map, shift_restrictions, max_monthly_work, strict, start_date, end_date,
    )

    if "PAO" in roles_to_generate:
        added = _backfill_pao_for_apao_gaps(
            year, month, planned, blocked, created, log,
            shift_map, shift_restrictions, max_monthly_work, strict,
            start_date, end_date,
        )
        if added:
            log.append({
                "tipo": "PAO SUBSTITUI APAO RESUMO",
                "data": "-", "cargo": "PAO", "turno": "-",
                "detalhe": f"{added} alocação(ões) PAO extra por falta de APAO.",
            })

    if not shifts_only:
        enforced = _enforce_mandatory_6x1_rests(year, month, log=log)
        if enforced:
            log.append({
                "tipo": "FOLGA 6X1 RESUMO", "data": "-", "cargo": "-", "turno": "-",
                "detalhe": f"Varredura final inseriu/corrigiu {enforced} folga(s) obrigatória(s) 6x1.",
            })

    for work_date, shift_code, emp_id, notes in created:
        add_assignment(work_date, shift_code, emp_id, notes)

    if not shifts_only:
        _sweep_remaining_blank_days(year, month, roles_to_generate, log)

    # 3. Passagem de Equalização de Carga Horária (Workload Equalization)
    for role in roles_to_generate:
        if role not in ["PAO", "APAO"]:
            continue
        emp_role_df = employees_df(role)
        if emp_role_df.empty or len(emp_role_df) <= 1:
            continue
        
        role_emp_ids = emp_role_df["id"].astype(int).tolist()
        manual_keys = _manual_assignment_keys(start_date, end_date, role_emp_ids)
        improved = True
        while improved:
            improved = False
            # Recarregar planned e blocked para o estado mais recente
            planned_current = {}
            sched_current = schedule_df(start_date - timedelta(days=1), end_date)
            if not sched_current.empty:
                for _, r in sched_current.iterrows():
                    planned_current[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]
            
            blocked_current = {}
            alloc_current = allocations_df(start_date - timedelta(days=1), end_date)
            if not alloc_current.empty:
                for _, r in alloc_current.iterrows():
                    blocked_current[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]
            
            # Calcular workloads
            workloads = {}
            for eid in role_emp_ids:
                workloads[eid] = sum(1 for (emp_id, d), sh in planned_current.items() if emp_id == eid and sh and start_date <= d <= end_date)
            
            max_eid = max(workloads, key=workloads.get)
            min_eid = min(workloads, key=workloads.get)
            
            if workloads[max_eid] - workloads[min_eid] <= 1:
                break
                
            # Tentar encontrar um dia para transferir um turno de max_eid para min_eid
            max_emp = emp_role_df[emp_role_df["id"] == max_eid].iloc[0].to_dict()
            min_emp = emp_role_df[emp_role_df["id"] == min_eid].iloc[0].to_dict()
            
            for d in iter_days(year, month):
                shift_code = planned_current.get((max_eid, d))
                if not shift_code:
                    continue
                if (max_eid, d) in manual_keys:
                    continue
                # min_eid não pode ter turno ou bloqueio nesse dia
                if planned_current.get((min_eid, d)) or (min_eid, d) in blocked_current:
                    continue
                
                # Temporariamente remover o turno de max_eid para validar se min_eid pode assumir
                temp_planned = dict(planned_current)
                temp_planned.pop((max_eid, d), None)
                
                # Validar se min_eid pode trabalhar (usando strict=False para permitir quinzena se necessário)
                ok, _ = can_work(
                    min_emp, d, shift_code, blocked_current, temp_planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=None, strict=False
                )
                if ok:
                    # Efetuar a transferência no banco de dados!
                    execute(
                        "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
                        (max_eid, str(d))
                    )
                    add_assignment(str(d), shift_code, min_eid, "Ajustado automaticamente para equalização de carga horária")
                    
                    log.append({
                        "tipo": "EQUILÍBRIO CARGA",
                        "data": str(d),
                        "cargo": role,
                        "turno": shift_code,
                        "detalhe": f"Transferido turno {shift_code} do dia {d} de {max_emp['nome']} para {min_emp['nome']} para equilibrar escala."
                    })
                    improved = True
                    break

    if not shifts_only:
        if "APAO" in roles_to_generate:
            apao_df = employees_df("APAO")
            if not apao_df.empty:
                from database.repositories import heal_apao_agroupada_rules
                for _, emp in apao_df.iterrows():
                    heal_apao_agroupada_rules(int(emp["id"]), (year, month))

        all_emp = employees_df()
        if not all_emp.empty:
            from database.repositories import heal_pao_social_rules
            for _, emp in all_emp.iterrows():
                emp_cargo = str(emp.get("cargo", "")).strip().upper()
                if emp_cargo in ["PAO", "PAO FCF"]:
                    heal_pao_social_rules(int(emp["id"]), (year, month))

    return pd.DataFrame(log)


def _shift_days_for_employee(emp_id, planned, days_in_month):
    return {d for d in days_in_month if planned.get((emp_id, d))}


def _count_shift_days(emp_id, planned, days_in_month):
    return len(_shift_days_for_employee(emp_id, planned, days_in_month))


def _count_productive_days(emp_id, planned, blocked, days_in_month):
    """Dias produtivos = turnos + VOO + CURSO ONLINE + SIMULADOR (sem duplicar o mesmo dia)."""
    productive_allocs = {"VOO", "CURSO ONLINE", "SIMULADOR", "CMA"}
    days = set()
    for d in days_in_month:
        if planned.get((emp_id, d)):
            days.add(d)
        elif str(blocked.get((emp_id, d), "")).upper() in productive_allocs:
            days.add(d)
    return len(days)


T9_BLOCK_SIZE = 3


def _pao_fcf_active_on_day(planned, blocked, role_map, day):
    for (eid, dk), sh in planned.items():
        if dk == day and role_map.get(int(eid)) == "PAO FCF" and sh:
            return True
    for (eid, dk), kind in blocked.items():
        if dk == day and role_map.get(int(eid)) == "PAO FCF":
            if str(kind).upper() in ["SIMULADOR", "CURSO ONLINE", "VOO", "ND"]:
                return True
    return False


def _t9_count_on_day(planned, role_map, day):
    return sum(
        1 for (eid, dk), sh in planned.items()
        if dk == day and sh == "T9" and role_map.get(int(eid)) == "PAO FCF"
    )


def _day_needs_t9_coverage(planned, blocked, role_map, day):
    if _pao_fcf_active_on_day(planned, blocked, role_map, day):
        return False
    return _t9_count_on_day(planned, role_map, day) < 1


def _can_work_t9_on_days(emp, days, blocked, planned, shift_map, shift_restrictions):
    for d in days:
        ok, _ = can_work(
            emp, d, "T9", blocked, planned,
            shift_map=shift_map, shift_restrictions=shift_restrictions,
            max_monthly_work=None, strict=False,
        )
        if not ok:
            return False
    return True


def _place_t9_assignments(emp_id, emp, days, planned, created, log, note_suffix=""):
    emp_id = int(emp_id)
    nome = emp.get("nome", "")
    suffix = f" — {note_suffix}" if note_suffix else ""
    for d in days:
        planned[(emp_id, d)] = "T9"
        note = f"Gerado automaticamente (T9 bloco {len(days)} dias{suffix})"
        created.append((str(d), "T9", emp_id, note))
        log.append({
            "tipo": "T9 BLOCO",
            "data": str(d),
            "cargo": "PAO FCF",
            "turno": "T9",
            "detalhe": f"{nome} — T9 em sequência de {len(days)} dia(s){suffix}.",
        })


def _allocate_pao_fcf_t9_triplets(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, start_date, end_date,
):
    """Prioriza T9 em blocos de 3 dias consecutivos."""
    from core.rules import build_employee_role_map

    emp_df = employees_df("PAO FCF")
    if emp_df.empty:
        return
    employees = emp_df.to_dict("records")
    role_map = build_employee_role_map()
    days = list(iter_days(year, month))

    for i in range(max(0, len(days) - 2)):
        window = [days[i], days[i + 1], days[i + 2]]
        if not all(_day_needs_t9_coverage(planned, blocked, role_map, d) for d in window):
            continue
        best = None
        for emp in employees:
            emp_id = int(emp["id"])
            if any(planned.get((emp_id, d)) for d in window):
                continue
            if not _can_work_t9_on_days(emp, window, blocked, planned, shift_map, shift_restrictions):
                continue
            load = current_month_workload(emp_id, planned, blocked, start_date, end_date)
            if best is None or load < best[0]:
                best = (load, emp)
        if best:
            _place_t9_assignments(int(best[1]["id"]), best[1], window, planned, created, log)


def _fill_remaining_pao_fcf_t9(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, start_date, end_date,
):
    """Preenche dias restantes sem cobertura FCF (fallback diário)."""
    from core.rules import build_employee_role_map

    emp_df = employees_df("PAO FCF")
    if emp_df.empty:
        return
    employees = emp_df.to_dict("records")
    role_map = build_employee_role_map()

    for d in iter_days(year, month):
        if not _day_needs_t9_coverage(planned, blocked, role_map, d):
            continue

        shifts_to_try = ["T9"]
        pao_shifts = shifts_df("PAO")
        if not pao_shifts.empty:
            for _, sh in pao_shifts.iterrows():
                code = sh["codigo"]
                if code == "T8":
                    continue
                need = int(sh["maximo"])
                have = sum(
                    1 for (eid, day_key), sc in planned.items()
                    if day_key == d and sc == code and role_map.get(int(eid)) == "PAO"
                )
                if have < need:
                    shifts_to_try.append(code)

        candidates = []
        for emp in employees:
            emp_id = int(emp["id"])
            current_worked = current_month_workload(emp_id, planned, blocked, start_date, end_date)
            if current_worked >= 11:
                continue
            for try_shift in shifts_to_try:
                ok, _ = can_work(
                    emp, d, try_shift, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=None, strict=False,
                )
                if ok:
                    candidates.append((current_worked, emp, try_shift))
                    break

        if not candidates:
            continue
        candidates.sort(key=lambda x: x[0])
        _, chosen_emp, chosen_shift = candidates[0]
        chosen_id = int(chosen_emp["id"])
        planned[(chosen_id, d)] = chosen_shift
        created.append((str(d), chosen_shift, chosen_id, "Gerado automaticamente (Coringa FCF)"))
        log.append({
            "tipo": "ALOCADO",
            "data": str(d),
            "cargo": "PAO FCF",
            "turno": chosen_shift,
            "detalhe": f"{chosen_emp['nome']} alocado no {chosen_shift} (Coringa).",
        })


def _t9_streaks_for_employee(emp_id, planned, days_in_month):
    streaks = []
    current = []
    for d in sorted(days_in_month):
        if planned.get((emp_id, d)) == "T9":
            if current and d != current[-1] + timedelta(days=1):
                streaks.append(current)
                current = [d]
            else:
                current.append(d)
        elif current:
            streaks.append(current)
            current = []
    if current:
        streaks.append(current)
    return streaks


def _repair_pao_fcf_t9_short_streaks(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, start_date, end_date,
):
    """Estende T9 mono/duplo para bloco de 3 dias quando possível."""
    from core.rules import build_employee_role_map

    emp_df = employees_df("PAO FCF")
    if emp_df.empty:
        return
    days = list(iter_days(year, month))
    role_map = build_employee_role_map()
    month_end = days[-1]

    for emp in emp_df.to_dict("records"):
        emp_id = int(emp["id"])
        for streak in _t9_streaks_for_employee(emp_id, planned, days):
            if len(streak) >= T9_BLOCK_SIZE:
                continue
            need = T9_BLOCK_SIZE - len(streak)
            extensions = []

            cursor = streak[-1]
            for _ in range(need):
                cursor += timedelta(days=1)
                if cursor > month_end:
                    break
                if planned.get((emp_id, cursor)) and planned.get((emp_id, cursor)) != "T9":
                    break
                if _t9_count_on_day(planned, role_map, cursor) >= 1 and planned.get((emp_id, cursor)) != "T9":
                    break
                ok, _ = can_work(
                    emp, cursor, "T9", blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    strict=False,
                )
                if ok:
                    extensions.append(cursor)
                else:
                    break

            if len(extensions) >= need:
                _place_t9_assignments(emp_id, emp, extensions, planned, created, log, "extensão")
                continue

            extensions = []
            cursor = streak[0]
            for _ in range(need):
                cursor -= timedelta(days=1)
                if cursor < days[0]:
                    break
                if planned.get((emp_id, cursor)) and planned.get((emp_id, cursor)) != "T9":
                    break
                if _t9_count_on_day(planned, role_map, cursor) >= 1 and planned.get((emp_id, cursor)) != "T9":
                    break
                ok, _ = can_work(
                    emp, cursor, "T9", blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    strict=False,
                )
                if ok:
                    extensions.insert(0, cursor)
                else:
                    break

            if len(extensions) >= need:
                _place_t9_assignments(emp_id, emp, extensions[:need], planned, created, log, "extensão")
            elif len(streak) < T9_BLOCK_SIZE:
                log.append({
                    "tipo": "T9 BLOCO PARCIAL",
                    "data": str(streak[0]),
                    "cargo": "PAO FCF",
                    "turno": "T9",
                    "detalhe": (
                        f"{emp['nome']}: T9 com {len(streak)} dia(s) "
                        f"({streak[0]}..{streak[-1]}) — não foi possível completar bloco de 3."
                    ),
                })


def _run_pao_fcf_daily_coverage(
    year, month, planned, blocked, created, log,
    shift_map, shift_restrictions, start_date, end_date,
):
    _allocate_pao_fcf_t9_triplets(
        year, month, planned, blocked, created, log,
        shift_map, shift_restrictions, start_date, end_date,
    )
    _fill_remaining_pao_fcf_t9(
        year, month, planned, blocked, created, log,
        shift_map, shift_restrictions, start_date, end_date,
    )
    _repair_pao_fcf_t9_short_streaks(
        year, month, planned, blocked, created, log,
        shift_map, shift_restrictions, start_date, end_date,
    )


def _adjacency_score_day(d, anchor_set):
    if not anchor_set:
        return 0
    score = 0
    for delta in (-1, 1, -2, 2):
        neighbor = d + timedelta(days=delta)
        if neighbor in anchor_set:
            score += max(1, 10 - abs(delta))
    return score


def _best_consecutive_pair(free_days, anchor_set):
    best = None
    best_score = -1
    for i in range(len(free_days) - 1):
        d1, d2 = free_days[i], free_days[i + 1]
        if d2 != d1 + timedelta(days=1):
            continue
        score = _adjacency_score_day(d1, anchor_set) + _adjacency_score_day(d2, anchor_set)
        if score > best_score:
            best_score = score
            best = (d1, d2)
    return best


def _best_consecutive_triple(free_days, anchor_set):
    best = None
    best_score = -1
    for i in range(len(free_days) - 2):
        d1, d2, d3 = free_days[i], free_days[i + 1], free_days[i + 2]
        if d2 == d1 + timedelta(days=1) and d3 == d1 + timedelta(days=2):
            score = sum(_adjacency_score_day(d, anchor_set) for d in (d1, d2, d3))
            if score > best_score:
                best_score = score
                best = (d1, d2, d3)
    return best


def _voo_isolated_between_shifts(d, shift_days):
    return (d - timedelta(days=1) in shift_days) and (d + timedelta(days=1) in shift_days)


def _shift_streak_score(emp_id, d, shift_days):
    before = 0
    curr = d - timedelta(days=1)
    while curr in shift_days:
        before += 1
        curr -= timedelta(days=1)
    after = 0
    curr = d + timedelta(days=1)
    while curr in shift_days:
        after += 1
        curr += timedelta(days=1)
    new_len = before + 1 + after
    if new_len >= 4:
        return 200 + new_len
    if before or after:
        return 80 + before + after
    return 10


def _rest_blocks_from_days(rest_days):
    blocks = []
    curr = []
    for d in sorted(rest_days):
        if not curr or d == curr[-1] + timedelta(days=1):
            curr.append(d)
        else:
            blocks.append(curr)
            curr = [d]
    if curr:
        blocks.append(curr)
    return blocks


def _shift_codes_for_employee(emp, role):
    if int(emp.get("fixo", 0) or 0) == 1 and emp.get("turno_fixo"):
        return [str(emp.get("turno_fixo")).strip()]
    sh_df = shifts_df(role if role != "PAO FCF" else "PAO")
    if not sh_df.empty:
        return [s["codigo"] for s in sh_df.to_dict("records") if s["codigo"] != "T8"]
    return ["T6", "T7", "T8"]


def _count_active_work_days(emp_id, planned, blocked, days_in_month):
    """Dias distintos com turno ou bloco ativo (VOO/simulador/curso)."""
    active = set()
    for d in days_in_month:
        if planned.get((emp_id, d)):
            active.add(d)
        if blocked.get((emp_id, d)) in ["SIMULADOR", "CURSO ONLINE", "VOO"]:
            active.add(d)
    return len(active)


def _reload_employee_planned_blocked(emp_id, year, month):
    start_date, end_date = month_range(year, month)
    days_in_month = list(iter_days(year, month))
    planned = {}
    sched = schedule_df(start_date - timedelta(days=1), end_date)
    if not sched.empty:
        for _, r in sched.iterrows():
            if int(r["funcionario_id"]) == int(emp_id):
                planned[(int(emp_id), pd.to_datetime(r["data"]).date())] = r["turno"]
    blocked = {}
    alloc = allocations_df(start_date - timedelta(days=1), end_date)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            if int(r["funcionario_id"]) == int(emp_id):
                blocked[(int(emp_id), pd.to_datetime(r["data"]).date())] = r["tipo"]
    return planned, blocked, days_in_month, start_date, end_date


def _reload_global_planned_blocked(year, month):
    start_date, end_date = month_range(year, month)
    days_in_month = list(iter_days(year, month))
    planned = {}
    sched = schedule_df(start_date - timedelta(days=1), end_date)
    if not sched.empty:
        for _, r in sched.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]
    blocked = {}
    alloc = allocations_df(start_date - timedelta(days=1), end_date)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]
    return planned, blocked, days_in_month, start_date, end_date


def _nd_required_after_t8_pair(emp_id, d, planned):
    """Terceiro dia após dois T8 consecutivos deve ser ND (regra T8,T8,ND)."""
    d1, d2 = d - timedelta(days=2), d - timedelta(days=1)
    return planned.get((emp_id, d1)) == "T8" and planned.get((emp_id, d2)) == "T8"


def _ensure_nd_after_t8(emp_id, d, planned, blocked, emp_nome, role, created):
    """Garante ND no dia obrigatório após par T8,T8 — remove conflitos no mesmo dia."""
    if blocked.get((emp_id, d)) == "ND":
        return True

    # Verificar se há uma alocação manual/protegida gravada no banco
    from database.connection import query_df
    from database.repositories import extract_original_type

    res = query_df("SELECT alloc_type, notes FROM allocations WHERE employee_id = ? AND alloc_date = ?", (int(emp_id), str(d)))
    if not res.empty:
        alloc_type = str(res.iloc[0]["alloc_type"]).upper()
        notes = str(res.iloc[0]["notes"] or "")
        orig_type, _ = extract_original_type(notes)

        def is_kept_local(a_type, a_notes):
            a_type_up = str(a_type).upper()
            a_notes_up = str(a_notes).upper()
            if a_type_up == "FOLGA":
                return "GERADO AUTOMATICAMENTE" not in a_notes_up and "PREENCHIMENTO" not in a_notes_up
            return a_type_up in {
                "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA ANIVERSÁRIO", "FÉRIAS",
                "DISPENSA MÉDICA", "CURSO ONLINE", "SIMULADOR"
            }

        is_manual = is_kept_local(alloc_type, notes) or (alloc_type in ("FOLGA SOCIAL", "FOLGA AGRUPADA") and orig_type and is_kept_local(orig_type, ""))
        if is_manual:
            # É uma alocação manual/protegida. Não a sobrescrevemos nem deletamos.
            return True

    if planned.get((emp_id, d)):
        execute(
            "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
            (int(emp_id), str(d)),
        )
        planned.pop((emp_id, d), None)
    if (emp_id, d) in blocked and blocked[(emp_id, d)] != "ND":
        execute(
            "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ?",
            (int(emp_id), str(d)),
        )
        blocked.pop((emp_id, d), None)
    add_allocation(emp_id, d, "ND", "Gerado automaticamente após 2 T8")
    blocked[(emp_id, d)] = "ND"
    created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": "ND (pós-T8)"})
    return True


def _ensure_all_t8_nd_blocks(emp_id, year, month, planned, blocked, emp_nome, role, created):
    """Varre o mês e aplica ND em todo dia exigido após blocos T8,T8."""
    _, _, days_in_month, _, end_date = _reload_global_planned_blocked(year, month)
    for d in days_in_month:
        if d > end_date:
            continue
        if _nd_required_after_t8_pair(emp_id, d, planned):
            _ensure_nd_after_t8(emp_id, d, planned, blocked, emp_nome, role, created)


def _repair_t8_window_rules(emp_id, emp, year, month):
    """Reaplica reparo oficial só na janela T8 (pareamento e ND) — sem varrer o mês inteiro."""
    cargo = str(emp.get("cargo", emp.get("role", ""))).strip().upper()
    if cargo == "PAO FCF":
        return
    from services.schedule_service import ScheduleService
    planned, _, days_in_month, _, _ = _reload_employee_planned_blocked(emp_id, year, month)
    repair_days = set()
    for d in days_in_month:
        if planned.get((emp_id, d)) == "T8":
            for offset in (-1, 0, 1, 2):
                repair_days.add(d + timedelta(days=offset))
    for d in sorted(repair_days):
        if d in days_in_month:
            ScheduleService.repair_employee_rules(emp_id, d)


def _try_place_shift(emp_id, emp, d, shift_code, planned, blocked, shift_map, shift_restrictions, auto_voo_dates=None):
    if _nd_required_after_t8_pair(emp_id, d, planned):
        return False
    has_voo = False
    voo_val = None
    if auto_voo_dates and d in auto_voo_dates:
        if (emp_id, d) in blocked:
            has_voo = True
            voo_val = blocked.pop((emp_id, d))
    ok, _ = can_work(
        emp, d, shift_code, blocked, planned,
        shift_map=shift_map, shift_restrictions=shift_restrictions,
        max_monthly_work=None, strict=False,
    )
    if not ok:
        if has_voo:
            blocked[(emp_id, d)] = voo_val
        return False
    if has_voo:
        execute(
            "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ? AND alloc_type = 'VOO'",
            (int(emp_id), str(d))
        )
        if d in auto_voo_dates:
            auto_voo_dates.remove(d)
    add_assignment(d, shift_code, emp_id, "Gerado automaticamente (densificação de turnos)")
    planned[(emp_id, d)] = shift_code
    m_start, m_end = month_range(d.year, d.month)
    manual = _manual_assignment_keys(m_start, m_end)
    _schedule_rest_if_six_complete(
        emp_id, d, d.year, d.month, planned, blocked, manual, None,
        emp_nome=str(emp.get("nome", "")),
    )
    return True


def _densify_shifts_for_employee(
    emp_id, emp, role, year, month, planned, blocked, target_shifts,
    days_in_month, emp_nome, created,
):
    shift_map = build_shift_time_map()
    shift_restrictions = build_shift_restriction_map(year, month)
    shift_codes = _shift_codes_for_employee(emp, role)

    from database.connection import query_df
    auto_voo_res = query_df("""
        SELECT alloc_date FROM allocations 
        WHERE employee_id = ? 
        AND alloc_type = 'VOO' 
        AND (notes LIKE 'Gerado automaticamente%' OR notes LIKE 'Preenchimento%')
    """, (emp_id,))
    auto_voo_dates = set(pd.to_datetime(auto_voo_res["alloc_date"]).dt.date.tolist()) if not auto_voo_res.empty else set()

    shift_window = _pilot_shift_block_days(emp_id, year, month, include_fixed=True) if get_block_group(emp_id, year, month, include_fixed=True) else None
    if shift_window is not None:
        shift_window = set(shift_window)

    while _count_productive_days(emp_id, planned, blocked, days_in_month) < target_shifts:
        shift_days = _shift_days_for_employee(emp_id, planned, days_in_month)
        candidates = []
        for d in days_in_month:
            if shift_window is not None and d not in shift_window:
                continue
            is_blocked = ((emp_id, d) in blocked) and (d not in auto_voo_dates)
            if is_blocked or planned.get((emp_id, d)):
                continue
            if _nd_required_after_t8_pair(emp_id, d, planned):
                continue
            for shift_code in shift_codes:
                has_voo = False
                voo_val = None
                if d in auto_voo_dates and (emp_id, d) in blocked:
                    has_voo = True
                    voo_val = blocked.pop((emp_id, d))
                ok, _ = can_work(
                    emp, d, shift_code, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=None, strict=False,
                )
                if has_voo:
                    blocked[(emp_id, d)] = voo_val
                if ok:
                    score = _shift_streak_score(emp_id, d, shift_days)
                    candidates.append((score, d, shift_code))
        if not candidates:
            break
        candidates.sort(key=lambda x: (-x[0], x[1]))
        _, chosen_day, chosen_shift = candidates[0]
        if _try_place_shift(
            emp_id, emp, chosen_day, chosen_shift, planned, blocked,
            shift_map, shift_restrictions, auto_voo_dates=auto_voo_dates
        ):
            created.append({
                "funcionario": emp_nome,
                "cargo": role,
                "data": str(chosen_day),
                "tipo": f"TURNO {chosen_shift}",
            })
        else:
            break


def _finalize_employee_month_coverage(
    emp_id, emp, role, year, month, emp_nome, created, append_voo_fn,
):
    """Garante 10 folgas, 20 dias produtivos (PAO) e elimina células vazias na grade visual."""
    if not is_employee_planning_active_month(emp_id, year, month):
        return

    MIN_RESTS = 10
    MIN_SHIFTS_PAO = employee_productive_target(emp_id, year, month)
    if MIN_SHIFTS_PAO <= 0:
        return

    planned, blocked, days_in_month, start_date, end_date = _reload_global_planned_blocked(year, month)
    plannable = set(employee_plannable_days(emp_id, year, month))
    shift_map = build_shift_time_map()
    shift_restrictions = build_shift_restriction_map(year, month)
    shift_codes = _shift_codes_for_employee(emp, role)

    from database.connection import query_df
    auto_voo_res = query_df("""
        SELECT alloc_date FROM allocations 
        WHERE employee_id = ? 
        AND alloc_type = 'VOO' 
        AND (notes LIKE 'Gerado automaticamente%' OR notes LIKE 'Preenchimento%')
    """, (emp_id,))
    auto_voo_dates = set(pd.to_datetime(auto_voo_res["alloc_date"]).dt.date.tolist()) if not auto_voo_res.empty else set()

    def empty_days():
        return [
            d for d in days_in_month
            if d in plannable
            and not planned.get((emp_id, d))
            and blocked.get((emp_id, d)) is None
        ]

    def empty_or_auto_voo_days():
        return [
            d for d in days_in_month
            if d in plannable
            and not planned.get((emp_id, d))
            and (blocked.get((emp_id, d)) is None or d in auto_voo_dates)
        ]

    # Completar folgas até 10
    while monthly_rest_count(emp_id, blocked) < MIN_RESTS:
        empties = empty_days()
        if empties:
            d = empties[0]
            add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
            blocked[(emp_id, d)] = "FOLGA"
            created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": "FOLGA (Complemento)"})
            continue
        # Troca VOO automático por folga se não houver dia livre
        swapped = False
        alloc_month = allocations_df(start_date, end_date)
        if not alloc_month.empty:
            emp_voos = alloc_month[
                (alloc_month["funcionario_id"] == emp_id) & (alloc_month["tipo"] == "VOO")
            ]
            for _, row in emp_voos.sort_values("data", ascending=False).iterrows():
                notes = str(row.get("observacao", row.get("notas", "")) or "")
                if "Gerado automaticamente" not in notes and "Preenchimento" not in notes:
                    continue
                d = pd.to_datetime(row["data"]).date()
                execute(
                    "DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ? AND alloc_type = 'VOO'",
                    (int(emp_id), str(d)),
                )
                blocked.pop((emp_id, d), None)
                if d in auto_voo_dates:
                    auto_voo_dates.remove(d)
                add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                blocked[(emp_id, d)] = "FOLGA"
                created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": "FOLGA (Troca VOO)"})
                swapped = True
                break
        if not swapped:
            # Converte um turno de densificação em folga se o mês já está cheio
            sched_month = schedule_df(start_date, end_date)
            if not sched_month.empty:
                auto_shifts = sched_month[
                    (sched_month["funcionario_id"] == emp_id)
                    & (sched_month["observacao"].astype(str).str.contains("densificação", case=False, na=False))
                ]
                if not auto_shifts.empty:
                    row = auto_shifts.iloc[-1]
                    d = pd.to_datetime(row["data"]).date()
                    execute(
                        "DELETE FROM assignments WHERE employee_id = ? AND work_date = ?",
                        (int(emp_id), str(d)),
                    )
                    planned.pop((emp_id, d), None)
                    add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                    blocked[(emp_id, d)] = "FOLGA"
                    created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": "FOLGA (Troca turno)"})
                    swapped = True
        if not swapped:
            break

    shift_window = _pilot_shift_block_days(emp_id, year, month, include_fixed=True) if get_block_group(emp_id, year, month, include_fixed=True) else None
    if shift_window is not None:
        shift_window = set(shift_window)
    voo_window = _pilot_off_block_days(emp_id, year, month, include_fixed=True) if get_block_group(emp_id, year, month, include_fixed=True) else set()

    while _count_productive_days(emp_id, planned, blocked, days_in_month) < MIN_SHIFTS_PAO:
        shift_days = _shift_days_for_employee(emp_id, planned, days_in_month)
        placed = False
        candidates = []
        for d in empty_or_auto_voo_days():
            if shift_window is not None and d not in shift_window:
                continue
            if _nd_required_after_t8_pair(emp_id, d, planned):
                continue
            for shift_code in shift_codes:
                has_voo = False
                voo_val = None
                if d in auto_voo_dates and (emp_id, d) in blocked:
                    has_voo = True
                    voo_val = blocked.pop((emp_id, d))
                ok, _ = can_work(
                    emp, d, shift_code, blocked, planned,
                    shift_map=shift_map, shift_restrictions=shift_restrictions,
                    max_monthly_work=None, strict=False,
                )
                if has_voo:
                    blocked[(emp_id, d)] = voo_val
                if ok:
                    candidates.append((_shift_streak_score(emp_id, d, shift_days), d, shift_code))
                    break
        if candidates:
            candidates.sort(key=lambda x: (-x[0], x[1]))
            _, d, shift_code = candidates[0]
            if _try_place_shift(emp_id, emp, d, shift_code, planned, blocked, shift_map, shift_restrictions, auto_voo_dates=auto_voo_dates):
                created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": f"TURNO {shift_code}"})
                placed = True
        if not placed:
            break

    # Lacunas: turno ou VOO (ND só via regra T8,T8,ND — nunca ND genérico)
    for d in list(empty_days()):
        if _nd_required_after_t8_pair(emp_id, d, planned):
            _ensure_nd_after_t8(emp_id, d, planned, blocked, emp_nome, role, created)
            continue
        if d in voo_window:
            if append_voo_fn(d, "Preenchimento rápido de células vazias", "VOO (Lacuna quinzena)"):
                blocked[(emp_id, d)] = "VOO"
            continue
        filled = False
        for shift_code in shift_codes:
            if _try_place_shift(
                emp_id, emp, d, shift_code, planned, blocked,
                shift_map, shift_restrictions,
            ):
                created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": f"TURNO {shift_code}"})
                filled = True
                break
        if not filled and append_voo_fn(d, "Preenchimento rápido de células vazias", "VOO (Lacuna)"):
            blocked[(emp_id, d)] = "VOO"


def auto_allocate_rests(year, month, roles_to_generate, folgas_only=False):
    """Aloca folgas (mín. 10, pref. 11) e, se folgas_only=False, VOO/blocos depois."""
    MIN_SHIFT_STREAK = 4
    QUALITY_BLOCK_MIN = 5
    QUALITY_BLOCK_MAX = 6

    target_roles = [r for r in roles_to_generate if r in ["PAO", "PAO FCF"]]
    if not target_roles:
        return pd.DataFrame()

    start_date, end_date = month_range(year, month)
    rest_kinds = [
        "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
        "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO", "FÉRIAS",
    ]

    placeholders = ",".join(["?"] * len(target_roles))
    params = [str(start_date), str(end_date)] + target_roles

    # Remove apenas VOO automático e ND de lacuna (preserva ND pós-T8 e reparos)
    execute(f"""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND (notes LIKE 'Gerado automaticamente%' OR notes LIKE 'Preenchimento%')
        AND alloc_type = 'VOO'
        AND employee_id IN (
            SELECT id FROM employees WHERE role IN ({placeholders})
        )
    """, tuple(params))
    execute(f"""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND alloc_type = 'ND'
        AND (notes LIKE '%cobrir lacuna%' OR notes LIKE '%Lacuna%')
        AND employee_id IN (
            SELECT id FROM employees WHERE role IN ({placeholders})
        )
    """, tuple(params))
    execute(f"""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND notes LIKE 'Gerado automaticamente%'
        AND alloc_type IN ('FOLGA', 'FOLGA SOCIAL')
        AND employee_id IN (
            SELECT id FROM employees WHERE role IN ({placeholders})
        )
        AND alloc_date NOT IN (
            SELECT work_date FROM assignments
            WHERE employee_id = allocations.employee_id
        )
    """, tuple(params))

    all_existing = schedule_df(start_date - timedelta(days=1), end_date)
    planned = {}
    if not all_existing.empty:
        for _, r in all_existing.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    alloc = allocations_df(start_date - timedelta(days=1), end_date)
    blocked = {}
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    created = []
    days_in_month = list(iter_days(year, month))
    weekends = []
    for d in days_in_month:
        if d.weekday() == 5:
            d2 = d + timedelta(days=1)
            if d2 <= end_date:
                weekends.append((d, d2))

    from database.repositories import heal_pao_social_rules

    for role in target_roles:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue

        # Ordenar os funcionários para processar os de turno fixo primeiro (prioridade)
        if "fixo" in emp_df.columns:
            emp_df = emp_df.sort_values(by="fixo", ascending=False)

        for _, emp in emp_df.iterrows():
            emp_id = int(emp["id"])
            emp_nome = emp["nome"]

            # Limpar pré-alocações automáticas de turno fixo no início do loop do funcionário para colocar folgas corretas
            if int(emp.get("fixo", 0) or 0) == 1:
                start_date_local, end_date_local = month_range(year, month)
                execute(
                    "DELETE FROM assignments WHERE employee_id = ? AND work_date BETWEEN ? AND ? AND notes = 'Gerado automaticamente (Turno Fixo)'",
                    (emp_id, str(start_date_local), str(end_date_local))
                )

            # Estado sempre sincronizado com o banco antes de alterar o funcionário
            planned, blocked, days_in_month, start_date, end_date = _reload_global_planned_blocked(
                year, month
            )

            emp_allocs = allocations_df(start_date, end_date)
            if not emp_allocs.empty:
                emp_allocs = emp_allocs[emp_allocs["funcionario_id"] == emp_id]
            if not is_employee_planning_active_month(emp_id, year, month):
                continue

            plannable = set(employee_plannable_days(emp_id, year, month))

            def get_status():
                rest_set = {
                    d for d in days_in_month
                    if d in plannable and blocked.get((emp_id, d)) in rest_kinds
                }
                free_days = [
                    d for d in days_in_month
                    if d in plannable and (emp_id, d) not in blocked and not planned.get((emp_id, d))
                ]
                return rest_set, free_days

            def append_folga(d, label):
                if monthly_rest_count(emp_id, blocked) >= TARGET_MAX_MONTHLY_RESTS:
                    if monthly_rest_count(emp_id, blocked) >= MIN_MONTHLY_RESTS:
                        return False
                if _is_protected_prealloc(blocked.get((emp_id, d))):
                    return False
                if planned.get((emp_id, d)):
                    return False
                add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                blocked[(emp_id, d)] = "FOLGA"
                created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": label})
                return True

            def append_voo(d, note, label):
                if _is_protected_prealloc(blocked.get((emp_id, d))):
                    return False
                if not employee_can_receive_flight(emp, d):
                    return False
                add_allocation(emp_id, d, "VOO", note)
                blocked[(emp_id, d)] = "VOO"
                created.append({"funcionario": emp_nome, "cargo": role, "data": str(d), "tipo": label})
                return True

            current_rests = monthly_rest_count(emp_id, blocked)
            needed = max(0, MIN_MONTHLY_RESTS - current_rests)

            rest_set, free_days = get_status()
            has_social_weekend = any(
                sat in rest_set and sun in rest_set for sat, sun in weekends
            )

            # 1) Garantir exatamente um par de fim de semana (vira FOLGA SOCIAL na cura)
            social_weekend = None
            if not has_social_weekend:
                for sat, sun in weekends:
                    folga_days = _folga_placement_days(emp_id, year, month, free_days)
                    if sat in folga_days and sun in folga_days:
                        social_weekend = (sat, sun)
                        break
                if not social_weekend:
                    for sat, sun in weekends:
                        if sat in free_days and sun in free_days:
                            social_weekend = (sat, sun)
                            break
                if social_weekend:
                    sat, sun = social_weekend
                    append_folga(sat, "FOLGA (Social)")
                    append_folga(sun, "FOLGA (Social)")
                    needed = max(0, MIN_MONTHLY_RESTS - monthly_rest_count(emp_id, blocked))
                    rest_set, free_days = get_status()

            # 2) Expandir fim de semana social para bloco de 3 folgas
            rest_set, free_days = get_status()
            if social_weekend and needed >= 1:
                sat, sun = social_weekend
                friday = sat - timedelta(days=1)
                monday = sun + timedelta(days=1)
                third_day = None
                if friday in free_days and friday >= start_date:
                    third_day = friday
                elif monday in free_days and monday <= end_date:
                    third_day = monday
                if third_day:
                    append_folga(third_day, "FOLGA (Agrupada 3 dias)")
                    needed = max(0, MIN_MONTHLY_RESTS - monthly_rest_count(emp_id, blocked))
                    rest_set, free_days = get_status()

            rest_set, free_days = get_status()
            has_3_block = False
            rest_list = sorted(rest_set)
            for i in range(len(rest_list) - 2):
                if (
                    rest_list[i + 1] == rest_list[i] + timedelta(days=1)
                    and rest_list[i + 2] == rest_list[i] + timedelta(days=2)
                ):
                    has_3_block = True
                    break

            if not has_3_block and needed >= 3:
                folga_days = _folga_placement_days(emp_id, year, month, free_days)
                three_block = _best_consecutive_triple(folga_days, rest_set)
                if not three_block:
                    three_block = _best_consecutive_triple(free_days, rest_set)
                if three_block:
                    for d in three_block:
                        append_folga(d, "FOLGA (Bloco 3)")
                    needed = max(0, MIN_MONTHLY_RESTS - monthly_rest_count(emp_id, blocked))
                    rest_set, free_days = get_status()

            # 3) Completar folgas em pares (agrupados perto das folgas existentes)
            while needed >= 2:
                folga_days = _folga_placement_days(emp_id, year, month, free_days)
                pair = _best_consecutive_pair(folga_days, rest_set)
                if not pair:
                    pair = _best_consecutive_pair(free_days, rest_set)
                if not pair:
                    break
                append_folga(pair[0], "FOLGA (Par)")
                append_folga(pair[1], "FOLGA (Par)")
                needed = max(0, MIN_MONTHLY_RESTS - monthly_rest_count(emp_id, blocked))
                rest_set, free_days = get_status()

            # 4) Última folga: pares ou única isolada (PAO/FCF: máx. 1 monofolga)
            if needed == 1:
                rest_set, free_days = get_status()
                placed = False
                if role != "APAO":
                    isolated = _isolated_rest_days(rest_set)
                    if len(isolated) < 1:
                        for d in free_days:
                            if (d - timedelta(days=1) in rest_set) or (d + timedelta(days=1) in rest_set):
                                append_folga(d, "FOLGA (Adjacente)")
                                needed = 0
                                placed = True
                                break
                else:
                    for d in free_days:
                        if (d - timedelta(days=1) in rest_set) or (d + timedelta(days=1) in rest_set):
                            append_folga(d, "FOLGA (Adjacente)")
                            needed = 0
                            placed = True
                            break
                if not placed:
                    pair = _best_consecutive_pair(free_days, rest_set)
                    if pair:
                        append_folga(pair[0], "FOLGA (Par 11º Dia)")
                        append_folga(pair[1], "FOLGA (Par 11º Dia)")
                        needed = 0
                rest_set, free_days = get_status()

            if needed > 0:
                if folgas_only:
                    while needed > 0:
                        rest_set, free_days = get_status()
                        if not free_days:
                            break
                        if monthly_rest_count(emp_id, blocked) >= TARGET_MAX_MONTHLY_RESTS:
                            break
                        if needed >= 2 and monthly_rest_count(emp_id, blocked) <= TARGET_MAX_MONTHLY_RESTS - 2:
                            pair = _best_consecutive_pair(free_days, rest_set)
                            if pair:
                                append_folga(pair[0], "FOLGA (Par)")
                                append_folga(pair[1], "FOLGA (Par)")
                                needed = max(0, MIN_MONTHLY_RESTS - monthly_rest_count(emp_id, blocked))
                                continue
                        if needed >= 1:
                            for d in free_days:
                                if append_folga(d, "FOLGA (Complemento)"):
                                    needed = max(0, MIN_MONTHLY_RESTS - monthly_rest_count(emp_id, blocked))
                                    break
                            else:
                                break
                        else:
                            break
                else:
                    needed = _fill_remaining_folgas_no_monofolga(
                        role, needed, get_status, append_folga, append_voo, emp_id, year, month,
                    )
                rest_set, free_days = get_status()

            if folgas_only:
                continue

            # 4b) Quinzena de VOO estilo planilha (Grupo A: 16–fim; Grupo B: 1–15)
            if role in ["PAO", "PAO FCF"] and get_block_group(emp_id, year, month, include_fixed=True):
                _strip_auto_shifts_from_wrong_fortnight(emp_id, year, month)
                _reclaim_voo_fortnight_from_auto_folgas(emp_id, year, month)
                planned, blocked, days_in_month, start_date, end_date = _reload_global_planned_blocked(
                    year, month
                )
                _spreadsheet_fill_voo_fortnight(
                    emp_id, emp, role, year, month, get_status, append_voo, append_folga,
                )
                planned, blocked, days_in_month, start_date, end_date = _reload_global_planned_blocked(
                    year, month
                )

            # 5) Blocos de qualidade 5–6 dias (folgas + VOO) — somente PAO regular
            if role == "PAO":
                rest_set, free_days = get_status()
                folga_only = {
                    d for d in days_in_month
                    if blocked.get((emp_id, d)) in rest_kinds[:6]
                }
                rest_blocks = _rest_blocks_from_days(folga_only)
                rest_blocks.sort(key=lambda b: len(b), reverse=True)

                shift_days = _shift_days_for_employee(emp_id, planned, days_in_month)
                for block in rest_blocks:
                    block_len = len(block)
                    target_extra = max(0, QUALITY_BLOCK_MIN - block_len)
                    if block_len < QUALITY_BLOCK_MAX:
                        target_extra = min(target_extra, QUALITY_BLOCK_MAX - block_len)
                    expansion_days = [
                        block[0] - timedelta(days=1),
                        block[-1] + timedelta(days=1),
                        block[0] - timedelta(days=2),
                        block[-1] + timedelta(days=2),
                    ]
                    flights_added = 0
                    rest_set, free_days = get_status()
                    shift_days = _shift_days_for_employee(emp_id, planned, days_in_month)
                    for d in expansion_days:
                        if flights_added >= target_extra:
                            break
                        if d < start_date or d > end_date or d not in free_days:
                            continue
                        if _voo_isolated_between_shifts(d, shift_days):
                            continue
                        if append_voo(d, "Gerado automaticamente para parear com folgas", "VOO (Agrupamento)"):
                            shift_days = _shift_days_for_employee(emp_id, planned, days_in_month)
                            flights_added += 1

            # 6) Densificar turnos até 20 (somente PAO regular)
            # Densificação de turnos só para PAO regular (PAO FCF segue regras próprias na geração)
            if role == "PAO":
                prod_target = employee_productive_target(emp_id, year, month)
                if prod_target > 0:
                    _densify_shifts_for_employee(
                        emp_id, emp, role, year, month, planned, blocked, prod_target,
                        days_in_month, emp_nome, created,
                    )

            # 7) VOO — quinzena de voo + residual (PAO e PAO FCF)
            if role in ["PAO", "PAO FCF"]:
                _allocate_voo_pool(
                    emp, emp_id, role, year, month, days_in_month, start_date, end_date,
                    get_status, append_voo,
                    shift_days_fn=lambda: _shift_days_for_employee(emp_id, planned, days_in_month),
                )

            # PAO FCF: folgas em pares (sem monofolgas extras)
            if role == "PAO FCF":
                while monthly_rest_count(emp_id, blocked) < MIN_MONTHLY_RESTS:
                    rest_set, free_days = get_status()
                    if not free_days:
                        break
                    if monthly_rest_count(emp_id, blocked) >= TARGET_MAX_MONTHLY_RESTS:
                        break
                    pair = _best_consecutive_pair(free_days, rest_set)
                    if pair:
                        append_folga(pair[0], "FOLGA (Par FCF)")
                        append_folga(pair[1], "FOLGA (Par FCF)")
                    elif len(_isolated_rest_days(rest_set)) < 1:
                        append_folga(free_days[0], "FOLGA (Única isolada FCF)")
                    elif folgas_only:
                        break
                    elif not append_voo(free_days[0], "Gerado automaticamente (VOO FCF)", "VOO (FCF)"):
                        break
                    planned, blocked, days_in_month, start_date, end_date = _reload_global_planned_blocked(year, month)

            if folgas_only:
                continue

            # 8) Fechamento (PAO: metas 10F/20T; regras T8/T8/ND)
            if role == "PAO":
                _finalize_employee_month_coverage(
                    emp_id, emp, role, year, month, emp_nome, created, append_voo,
                )
                planned, blocked, _, _, _ = _reload_employee_planned_blocked(emp_id, year, month)
                _ensure_all_t8_nd_blocks(emp_id, year, month, planned, blocked, emp_nome, role, created)
                _repair_t8_window_rules(emp_id, emp, year, month)
                heal_pao_social_rules(emp_id, (year, month))

            if role in ["PAO", "PAO FCF"]:
                _enforce_max_one_monofolga(emp_id, role, year, month, append_voo)
                planned, blocked, days_in_month, start_date, end_date = _reload_global_planned_blocked(year, month)

    if not folgas_only:
        _enforce_mandatory_6x1_rests(year, month)

        for role in ["PAO", "PAO FCF"]:
            emp_df = employees_df(role)
            if emp_df.empty:
                continue
            for _, emp in emp_df.iterrows():
                _enforce_max_one_monofolga(int(emp["id"]), role, year, month, None)

    return pd.DataFrame(created)