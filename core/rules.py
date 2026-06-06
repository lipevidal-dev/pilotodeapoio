import calendar
from datetime import datetime, date, timedelta
import pandas as pd

from database.repositories import (
    employees_df,
    shifts_df,
    allocations_df,
    shift_restrictions_df,
    schedule_df,
)

BLOCK_TYPES = {
    "FOLGA",
    "FOLGA SOCIAL",
    "FOLGA PEDIDA",
    "DISPENSA MÉDICA",
    "FÉRIAS",
    "CURSO ONLINE",
    "SIMULADOR",
    "VOO",
    "ND",
    "FOLGA AGRUPADA",
    "FOLGA ANIVERSÁRIO",
}

def month_range(year, month):
    """Retorna o primeiro e último dia do mês/ano informados."""
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return first, last

def iter_days(year, month):
    """Gerador que itera sobre todos os dias da competência."""
    first, last = month_range(year, month)
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)

def parse_hhmm(value):
    """Converte string hh:mm em inteiros de hora e minuto."""
    hour, minute = str(value).split(":")
    return int(hour), int(minute)

def shift_start_end_datetimes(work_day, start_time, end_time):
    """Calcula os datetimes reais de início e fim de um turno, lidando com virada de meia-noite."""
    sh, sm = parse_hhmm(start_time)
    eh, em = parse_hhmm(end_time)

    start_dt = datetime.combine(work_day, datetime.min.time()).replace(hour=sh, minute=sm)
    end_dt = datetime.combine(work_day, datetime.min.time()).replace(hour=eh, minute=em)

    # Se o fim é menor ou igual ao início, o turno termina no dia seguinte.
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)

    return start_dt, end_dt

def build_shift_time_map():
    """Mapeia os turnos para acesso rápido aos horários e cargo."""
    df = shifts_df()
    return {
        row["codigo"]: {
            "inicio": row["inicio"],
            "fim": row["fim"],
            "cargo": row["cargo"],
            "no_fds": int(row.get("no_fds", 0)),
        }
        for _, row in df.iterrows()
    }

def build_employee_role_map():
    """Retorna um mapeamento rápido de id_funcionario -> cargo."""
    df = employees_df()
    if df.empty:
        return {}
    return {int(row["id"]): str(row["cargo"]).strip().upper() for _, row in df.iterrows()}

def has_12h_rest(emp_id, day, shift_code, planned, shift_map):
    """Verifica se há descanso mínimo de 12 horas entre o turno proposto e os planejados."""
    try:
        if not shift_map or shift_code not in shift_map:
            return True, ""

        cand_start, cand_end = shift_start_end_datetimes(
            day,
            shift_map[shift_code]["inicio"],
            shift_map[shift_code]["fim"]
        )

        for (other_emp_id, other_day), other_shift in planned.items():
            if int(other_emp_id) != int(emp_id):
                continue
            if other_shift not in shift_map:
                continue

            other_start, other_end = shift_start_end_datetimes(
                other_day,
                shift_map[other_shift]["inicio"],
                shift_map[other_shift]["fim"]
            )

            if cand_start >= other_end:
                rest_hours = (cand_start - other_end).total_seconds() / 3600
                if rest_hours < 12:
                    return False, f"descanso de apenas {rest_hours:.1f}h após {other_shift}"

            elif other_start >= cand_end:
                rest_hours = (other_start - cand_end).total_seconds() / 3600
                if rest_hours < 12:
                    return False, f"descanso de apenas {rest_hours:.1f}h antes de {other_shift}"

            else:
                return False, f"sobreposição com {other_shift}"

        return True, ""

    except Exception as exc:
        return False, f"erro ao validar descanso: {exc}"

def max_simultaneous_workers_if_added(emp_id, day, shift_code, planned, shift_map):
    """Calcula o pico de trabalhadores simultâneos se adicionarmos o turno candidato."""
    intervals = []
    role_map = build_employee_role_map()

    for (other_emp_id, other_day), other_shift in planned.items():
        if other_shift not in shift_map:
            continue
        if str(other_shift).strip().upper() in ("T9", "T09"):
            continue
        if role_map.get(int(other_emp_id)) == "PAO FCF":
            continue
        start, end = shift_start_end_datetimes(other_day, shift_map[other_shift]["inicio"], shift_map[other_shift]["fim"])
        intervals.append((start, end, int(other_emp_id), other_shift))

    if role_map.get(int(emp_id)) != "PAO FCF":
        if shift_code in shift_map:
            if str(shift_code).strip().upper() not in ("T9", "T09"):
                start, end = shift_start_end_datetimes(day, shift_map[shift_code]["inicio"], shift_map[shift_code]["fim"])
                intervals.append((start, end, int(emp_id), shift_code))

    events = []
    for start, end, _eid, _shift in intervals:
        events.append((start, 1))
        events.append((end, -1))

    events.sort(key=lambda x: (x[0], x[1]))

    current = 0
    max_count = 0
    for _time, delta in events:
        current += delta
        max_count = max(max_count, current)

    return max_count

def consecutive_work_count(emp_id, day, planned):
    """Conta os dias de trabalho consecutivos até o dia anterior ao informado."""
    count = 0
    d = day - timedelta(days=1)
    loaded_dates = {key[1] for key in planned.keys()}
    while True:
        if d in loaded_dates:
            if planned.get((emp_id, d)):
                count += 1
                d -= timedelta(days=1)
            else:
                break
        else:
            sched = schedule_df(d, d)
            has_work = False
            if not sched.empty:
                has_work = not sched[sched["funcionario_id"] == int(emp_id)].empty
            if has_work:
                count += 1
                d -= timedelta(days=1)
            else:
                break
    return count

def t8_previous_count(emp_id, day, planned):
    """Conta quantos turnos T8 seguidos o funcionário fez imediatamente antes."""
    count = 0
    d = day - timedelta(days=1)
    while planned.get((emp_id, d)) == "T8":
        count += 1
        d -= timedelta(days=1)
    return count

def shift_count_for_employee(emp_id, shift_code, planned):
    """Quantidade de vezes que o funcionário foi alocado no turno específico no plano atual."""
    return sum(1 for (eid, _day), sh in planned.items() if eid == emp_id and sh == shift_code)

def total_work_for_employee(emp_id, planned):
    """Total de dias de escala ocupados pelo funcionário no plano."""
    return sum(1 for (eid, _day), sh in planned.items() if eid == emp_id and sh)

def role_for_shift(shift_code, shift_map):
    """Retorna o cargo (PAO ou APAO) a que se destina o turno."""
    return shift_map.get(shift_code, {}).get("cargo", "")

def interval_covered_by_pao(cand_start, cand_end, planned, shift_map):
    """Verifica se o intervalo cand_start->cand_end está 100% coberto por turnos de PAOs na escala."""
    pao_intervals = []
    role_map = build_employee_role_map()

    for (other_emp_id, other_day), other_shift in planned.items():
        if other_shift not in shift_map:
            continue
        if role_for_shift(other_shift, shift_map) != "PAO":
            continue
        if role_map.get(int(other_emp_id)) == "PAO FCF":
            continue

        start, end = shift_start_end_datetimes(
            other_day,
            shift_map[other_shift]["inicio"],
            shift_map[other_shift]["fim"]
        )

        if end > cand_start and start < cand_end:
            pao_intervals.append((max(start, cand_start), min(end, cand_end)))

    if not pao_intervals:
        return False

    pao_intervals.sort(key=lambda x: x[0])

    current = cand_start
    for start, end in pao_intervals:
        if start > current:
            return False
        if end > current:
            current = end
        if current >= cand_end:
            return True

    return current >= cand_end

def apao_has_no_other_apao_overlap(emp_id, day, shift_code, planned, shift_map):
    """Garante que não há dois APAOs trabalhando ao mesmo tempo."""
    if shift_code not in shift_map:
        return True

    cand_start, cand_end = shift_start_end_datetimes(
        day,
        shift_map[shift_code]["inicio"],
        shift_map[shift_code]["fim"]
    )

    for (other_emp_id, other_day), other_shift in planned.items():
        if other_shift not in shift_map:
            continue
        if role_for_shift(other_shift, shift_map) != "APAO":
            continue

        other_start, other_end = shift_start_end_datetimes(
            other_day,
            shift_map[other_shift]["inicio"],
            shift_map[other_shift]["fim"]
        )

        if cand_start < other_end and cand_end > other_start:
            return False

    return True

def apao_has_pao_companion(day, shift_code, planned, shift_map):
    """APAO deve estar sob a asa de cobertura de pelo menos um PAO em serviço."""
    if shift_code not in shift_map:
        return False

    cand_start, cand_end = shift_start_end_datetimes(
        day,
        shift_map[shift_code]["inicio"],
        shift_map[shift_code]["fim"]
    )

    return interval_covered_by_pao(cand_start, cand_end, planned, shift_map)


def apao_shortfall_on_day(day, planned, role_map=None):
    """Quantos slots APAO (T1–T4) ainda faltam no dia."""
    from database.repositories import shifts_df

    if role_map is None:
        role_map = build_employee_role_map()
    apao_sh = shifts_df("APAO")
    if apao_sh.empty:
        return 0
    gap = 0
    for _, row in apao_sh.iterrows():
        code = str(row["codigo"])
        need = int(row["maximo"])
        have = sum(
            1 for (eid, d), sh in planned.items()
            if d == day and sh == code and str(role_map.get(int(eid), "")).startswith("APAO")
        )
        if have < need:
            gap += need - have
    return gap


def pao_shift_capacity_on_day(day, shift_code, planned, role_map=None, apao_substitute=False):
    """Máximo de PAO no turno: 2 se faltar APAO no dia, senão 1."""
    if role_map is None:
        role_map = build_employee_role_map()
    base = 2 if apao_substitute and apao_shortfall_on_day(day, planned, role_map) > 0 else 1
    return base

def monthly_work_count(emp_id, planned):
    """Conta os dias de trabalho efetivo do funcionário na competência."""
    return sum(1 for (eid, _day), sh in planned.items() if int(eid) == int(emp_id) and sh)

def monthly_rest_count(emp_id, blocked):
    """Conta o total de folgas em geral registradas para o funcionário na competência."""
    return sum(
        1 for (eid, _day), kind in blocked.items()
        if int(eid) == int(emp_id) and kind in ["FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO"]
    )

VACATION_TYPES = {"FÉRIAS", "FERIAS", "FER", "FÉRIA", "FERIA"}


def is_employee_on_vacation(emp_id, target_date):
    """Informa se o funcionário possui registro ativo de férias em uma data."""
    target_date = pd.to_datetime(target_date).date()
    alloc = allocations_df(target_date, target_date)

    if alloc.empty:
        return False

    try:
        emp_alloc = alloc[
            (alloc["funcionario_id"].astype(int) == int(emp_id)) &
            (pd.to_datetime(alloc["data"]).dt.date == target_date)
        ]
    except Exception:
        return False

    if emp_alloc.empty:
        return False

    tipos = set(str(x).strip().upper() for x in emp_alloc["tipo"].tolist())
    return any(t in VACATION_TYPES for t in tipos)


def employee_vacation_dates(emp_id, year, month):
    """Datas do mês em que o funcionário está de férias."""
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    out = set()
    if alloc.empty:
        return out
    sub = alloc[alloc["funcionario_id"].astype(int) == int(emp_id)]
    for _, r in sub.iterrows():
        if str(r.get("tipo", "")).strip().upper() in VACATION_TYPES:
            out.add(pd.to_datetime(r["data"]).date())
    return out


def employee_plannable_days(emp_id, year, month):
    """Dias do mês em que o funcionário participa do planejamento (não está de férias)."""
    vac = employee_vacation_dates(emp_id, year, month)
    return [d for d in iter_days(year, month) if d not in vac]


def employee_nd_count(emp_id, year, month) -> int:
    """Quantidade de ND no mês (cada um reduz 1 da meta de produtivos)."""
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    if alloc.empty:
        return 0
    sub = alloc[
        (alloc["funcionario_id"].astype(int) == int(emp_id))
        & (alloc["tipo"].astype(str).str.upper() == "ND")
    ]
    return len(sub)


def employee_productive_target(emp_id, year, month, base: int = 20) -> int:
    """
    Meta de dias produtivos: 20 − ND (cada bloco T8/T8/ND consome 1 na meta).
    Piloto de férias o mês inteiro: meta 0.
    """
    if not is_employee_planning_active_month(emp_id, year, month):
        return 0
    return max(0, int(base) - employee_nd_count(emp_id, year, month))


def is_employee_in_planning(emp_id, target_date):
    """False nos dias de férias — funcionário fora do planejamento."""
    return not is_employee_on_vacation(emp_id, target_date)


def is_employee_planning_active_month(emp_id, year, month):
    """False se o mês inteiro é férias (funcionário ausente do planejamento mensal)."""
    return len(employee_plannable_days(emp_id, year, month)) > 0


def fortnight_dates(year, month, fortnight: int):
    """1 = dias 1–15; 2 = dias 16–fim."""
    _, last = calendar.monthrange(year, month)
    if fortnight == 1:
        return [d for d in iter_days(year, month) if d.day <= min(15, last)]
    return [d for d in iter_days(year, month) if d.day >= 16]


def is_employee_on_vacation_fortnight(emp_id, year, month, fortnight: int):
    """True se todos os dias da quinzena estão marcados como férias."""
    days = fortnight_dates(year, month, fortnight)
    if not days:
        return False
    vac = employee_vacation_dates(emp_id, year, month)
    return all(d in vac for d in days)


def vacation_employee_ids_by_day(year, month):
    """Busca o conjunto de IDs de funcionários em férias por dia."""
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    result = {}

    if alloc.empty:
        return result

    ferias_tipos = VACATION_TYPES
    for _, r in alloc.iterrows():
        tipo = str(r.get("tipo", "")).strip().upper()
        if tipo not in ferias_tipos:
            continue
        try:
            d = pd.to_datetime(r["data"]).date()
            eid = int(r["funcionario_id"])
            result.setdefault(d, set()).add(eid)
        except Exception:
            pass

    return result

def apao_available_count_by_day(year, month):
    """Avalia o volume de estagiários APAO disponíveis para alocação dia a dia."""
    start_date, end_date = month_range(year, month)
    apao = employees_df("APAO")
    alloc = allocations_df(start_date, end_date, role="APAO")

    rows = []
    if apao.empty:
        return pd.DataFrame(rows)

    rest_types = {"FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FÉRIAS", "DISPENSA MÉDICA", "CURSO ONLINE", "SIMULADOR", "VOO", "ND"}

    for d in iter_days(year, month):
        blocked_ids = set()
        if not alloc.empty:
            a_day = alloc[pd.to_datetime(alloc["data"]).dt.date == d]
            for _, a in a_day.iterrows():
                if a["tipo"] in rest_types:
                    blocked_ids.add(int(a["funcionario_id"]))

        total = len(apao)
        available = total - len(blocked_ids)

        rows.append({
            "data": str(d),
            "apao_total": total,
            "apao_bloqueados": len(blocked_ids),
            "apao_disponiveis": available
        })

    return pd.DataFrame(rows)

def apao_block_count_by_day(year, month):
    """Mapeia volume de folgas ou impedimentos cadastrados de estagiários APAO por dia."""
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date, role="APAO")
    if alloc.empty:
        return pd.DataFrame(columns=["data", "qtd_apao_bloqueado"])

    blocking_types = [
        "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA",
        "FÉRIAS", "DISPENSA MÉDICA", "CURSO ONLINE", "SIMULADOR", "VOO", "ND"
    ]
    blocked = alloc[alloc["tipo"].isin(blocking_types)]
    if blocked.empty:
        return pd.DataFrame(columns=["data", "qtd_apao_bloqueado"])

    return blocked.groupby("data").size().reset_index(name="qtd_apao_bloqueado")

def consecutive_work_count_from_database(emp_id, day):
    """Pede no banco de dados a quantidade de dias consecutivos já trabalhados retrocedendo à data."""
    count = 0
    cursor = pd.to_datetime(day).date() - timedelta(days=1)
    for _ in range(10):
        sched = schedule_df(cursor, cursor)
        has_work = False
        if not sched.empty:
            has_work = not sched[sched["funcionario_id"] == int(emp_id)].empty
        if has_work:
            count += 1
            cursor -= timedelta(days=1)
        else:
            break
    return count

def validate_previous_month_continuity(year, month):
    """Confirma se o acúmulo de trabalho de quem vinha escalado no fim do mês anterior não estoura 6 dias."""
    start_date, end_date = month_range(year, month)
    sched = schedule_df(start_date, end_date)
    rows = []
    if sched.empty:
        return pd.DataFrame(rows)

    emp = employees_df()
    for _, e in emp.iterrows():
        if e.cargo == "PAO FCF":
            continue
        emp_id = int(e["id"])
        before_count = consecutive_work_count_from_database(emp_id, start_date)
        initial = 0
        for d in iter_days(year, month):
            day_sched = sched[(sched["funcionario_id"] == emp_id) & (pd.to_datetime(sched["data"]).dt.date == d)]
            if not day_sched.empty:
                initial += 1
            else:
                break
        total = before_count + initial
        if total > 6:
            rows.append({
                "gravidade": "ALTA",
                "tipo": "CONTINUIDADE MÊS ANTERIOR",
                "data": str(start_date),
                "funcionario": e["nome"],
                "detalhe": f"Funcionário vinha de {before_count} dia(s) trabalhados no mês anterior e iniciou com {initial} dia(s). Total consecutivo: {total}. Máximo: 6."
            })
    return pd.DataFrame(rows)

class BaseRule:
    """Interface base para todas as especificações de regras de validação da escala."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map) -> list[dict]:
        raise NotImplementedError


class ShiftCapacityRule(BaseRule):
    """Garante que os turnos respeitem a capacidade mínima e máxima cadastrada."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        merged = sched.merge(shifts[["codigo", "minimo", "maximo", "cargo"]], left_on="turno", right_on="codigo", how="left")
        grp = merged.groupby(["data", "turno", "minimo", "maximo"]).size().reset_index(name="qtd")
        for _, r in grp.iterrows():
            if start_date and end_date:
                r_date = pd.to_datetime(r.data).date()
                if not (start_date <= r_date <= end_date):
                    continue
            if r.qtd > r.maximo:
                issues.append({
                    "gravidade": "ALTA",
                    "tipo": "EXCESSO TURNO",
                    "data": r.data,
                    "funcionario": "-",
                    "detalhe": f"Turno {r.turno} com {r.qtd} funcionários. Máximo permitido: {r.maximo}."
                })
            if r.qtd < r.minimo:
                issues.append({
                    "gravidade": "MÉDIA",
                    "tipo": "FALTA TURNO",
                    "data": r.data,
                    "funcionario": "-",
                    "detalhe": f"Turno {r.turno} com {r.qtd} funcionário(s). Mínimo exigido: {r.minimo}."
                })
        return issues


class DuplicityRule(BaseRule):
    """Garante que nenhum funcionário seja alocado em múltiplos turnos no mesmo dia."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        dup = sched.groupby(["data", "funcionario"])["turno"].nunique().reset_index(name="turnos")
        for _, r in dup[dup["turnos"] > 1].iterrows():
            if start_date and end_date:
                r_date = pd.to_datetime(r.data).date()
                if not (start_date <= r_date <= end_date):
                    continue
            issues.append({
                "gravidade": "ALTA",
                "tipo": "DUPLICIDADE",
                "data": r.data,
                "funcionario": r.funcionario,
                "detalhe": "Funcionário alocado em mais de um turno no mesmo dia."
            })
        return issues


class Rest12hRule(BaseRule):
    """Garante descanso de no mínimo 12 horas entre turnos consecutivos."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        for funcionario, df_f in sched.groupby("funcionario"):
            rows = []
            for _, item in df_f.iterrows():
                work_day = pd.to_datetime(item["data"]).date()
                shift_code = item["turno"]
                if shift_code not in shift_map:
                    continue
                start_dt, end_dt = shift_start_end_datetimes(
                    work_day,
                    shift_map[shift_code]["inicio"],
                    shift_map[shift_code]["fim"]
                )
                rows.append((start_dt, end_dt, shift_code, item["data"]))

            rows.sort(key=lambda x: x[0])
            for i in range(1, len(rows)):
                prev_start, prev_end, prev_shift, prev_date = rows[i-1]
                curr_start, curr_end, curr_shift, curr_date = rows[i]
                rest_hours = (curr_start - prev_end).total_seconds() / 3600
                if rest_hours < 12:
                    if start_date and end_date:
                        curr_d = pd.to_datetime(curr_date).date()
                        if not (start_date <= curr_d <= end_date):
                            continue
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "DESCANSO MENOR QUE 12H",
                        "data": str(curr_date),
                        "funcionario": funcionario,
                        "detalhe": f"Descanso de {rest_hours:.1f}h entre {prev_shift} e {curr_shift}. Mínimo exigido: 12h."
                    })
        return issues


class SimultaneousStationsRule(BaseRule):
    """Garante limite físico de 2 estações simultâneas em todo o escritório (excluindo T9 e PAO FCF)."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        for day in pd.to_datetime(sched["data"]).dt.date.unique():
            if start_date and end_date:
                if not (start_date <= day <= end_date):
                    continue
            day_sched = sched[pd.to_datetime(sched["data"]).dt.date == day]
            events = []
            for _, item in day_sched.iterrows():
                sh = item["turno"]
                if sh not in shift_map:
                    continue
                if str(sh).strip().upper() in ("T9", "T09"):
                    continue
                if role_map.get(int(item["funcionario_id"])) == "PAO FCF":
                    continue
                start_dt, end_dt = shift_start_end_datetimes(day, shift_map[sh]["inicio"], shift_map[sh]["fim"])
                events.append((start_dt, 1, item["funcionario"], sh))
                events.append((end_dt, -1, item["funcionario"], sh))
            events.sort(key=lambda x: (x[0], x[1]))
            current = 0
            for t, delta, func, sh in events:
                current += delta
                if current > 2:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "MAIS DE 2 SIMULTÂNEOS",
                        "data": str(day),
                        "funcionario": "-",
                        "detalhe": f"Mais de 2 funcionários simultâneos por volta de {t.strftime('%H:%M')}. Limite físico: 2 estações."
                    })
                    break
        return issues


class BlockedShiftRule(BaseRule):
    """Garante que o funcionário não trabalhe em turnos que possuam restrição mensal configurada."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        restr_df = shift_restrictions_df(year, month) if year and month else pd.DataFrame()
        if not restr_df.empty:
            for _, item in sched.iterrows():
                work_day = pd.to_datetime(item["data"]).date()
                if start_date and end_date and not (start_date <= work_day <= end_date):
                    continue
                employee_restr = restr_df[
                    (restr_df["funcionario_id"] == int(item["funcionario_id"])) &
                    (restr_df["turno_bloqueado"] == item["turno"])
                ]
                if not employee_restr.empty:
                     issues.append({
                        "gravidade": "ALTA",
                        "tipo": "TURNO BLOQUEADO",
                        "data": str(item["data"]),
                        "funcionario": item["funcionario"],
                        "detalhe": f"Funcionário foi alocado no {item['turno']}, mas este turno está bloqueado para ele no mês."
                    })
        return issues


class ApaoCompanionRule(BaseRule):
    """APAO isolado: proíbe dois APAOs no mesmo turno; pareamento com PAO não é obrigatório."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        planned_validation = {}
        for _, item in sched.iterrows():
            planned_validation[(int(item["funcionario_id"]), pd.to_datetime(item["data"]).date())] = item["turno"]

        for _, item in sched.iterrows():
            if item["turno"] in shift_map and role_for_shift(item["turno"], shift_map) == "APAO":
                emp_role = role_map.get(int(item["funcionario_id"]), "")
                if emp_role.startswith("APAO"):
                    work_day = pd.to_datetime(item["data"]).date()
                    if start_date and end_date and not (start_date <= work_day <= end_date):
                        continue
                    temp_planned = dict(planned_validation)
                    temp_planned.pop((int(item["funcionario_id"]), work_day), None)

                    if not apao_has_no_other_apao_overlap(int(item["funcionario_id"]), work_day, item["turno"], temp_planned, shift_map):
                        issues.append({
                            "gravidade": "ALTA",
                            "tipo": "APAO JUNTO COM APAO",
                            "data": str(item["data"]),
                            "funcionario": item["funcionario"],
                            "detalhe": "Dois APAOs simultâneos não são permitidos.",
                        })
        return issues


class BlockedDayWorkRule(BaseRule):
    """Garante que funcionários não sejam escalados em dias com bloqueios (férias, licenças etc.), com exceção do PAO FCF."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty or alloc.empty:
            return issues
        bloqueios = alloc[alloc["tipo"].isin(list(BLOCK_TYPES))]
        for _, b in bloqueios.iterrows():
            b_date = pd.to_datetime(b.data).date()
            if start_date and end_date and not (start_date <= b_date <= end_date):
                continue
            if str(b["cargo"]).strip().upper() == "PAO FCF" and str(b["tipo"]).strip().upper() in ["SIMULADOR", "CURSO ONLINE", "VOO"]:
                continue
            conflict = sched[(sched["data"] == b.data) & (sched["funcionario"] == b.funcionario)]
            if not conflict.empty:
                issues.append({
                    "gravidade": "ALTA",
                    "tipo": "TRABALHO EM DIA BLOQUEADO",
                    "data": b.data,
                    "funcionario": b.funcionario,
                    "detalhe": f"Existe alocação '{b.tipo}' e também escala de trabalho no mesmo dia."
                })
        return issues


class T8PairingRule(BaseRule):
    """Garante pareamento T8 (dois dias seguidos) e folga obrigatória no terceiro dia (ND)."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        t8 = sched[sched["turno"] == "T8"]
        alloc_nd = alloc[alloc["tipo"] == "ND"] if not alloc.empty else pd.DataFrame()
        for funcionario, df_f in t8.groupby("funcionario"):
            emp_match = employees_df()
            emp_match = emp_match[emp_match["nome"] == funcionario]
            emp_id = int(emp_match.iloc[0]["id"]) if not emp_match.empty else None
            dates = sorted(pd.to_datetime(df_f["data"]).dt.date.unique())
            dates_set = set(dates)

            for current_day in dates:
                if emp_id is not None and is_employee_on_vacation(emp_id, current_day):
                    continue
                prev_is_t8 = (current_day - timedelta(days=1)) in dates_set
                next_is_t8 = (current_day + timedelta(days=1)) in dates_set

                if not prev_is_t8 and not next_is_t8:
                    if start_date and end_date and start_date <= current_day <= end_date:
                        issues.append({
                            "gravidade": "MÉDIA",
                            "tipo": "T8 ISOLADO",
                            "data": str(current_day),
                            "funcionario": funcionario,
                            "detalhe": "T8 deve ser pareado em dois dias consecutivos: T8,T8,ND."
                        })

                if next_is_t8:
                    nd_day = current_day + timedelta(days=2)
                    if emp_id is not None and is_employee_on_vacation(emp_id, nd_day):
                        continue
                    if start_date and end_date and start_date <= nd_day <= end_date:
                        nd_ok = False
                        if not alloc_nd.empty:
                            nd_match = alloc_nd[
                                (alloc_nd["funcionario"] == funcionario) &
                                (pd.to_datetime(alloc_nd["data"]).dt.date == nd_day)
                            ]
                            nd_ok = not nd_match.empty
    
                        if not nd_ok:
                            issues.append({
                                "gravidade": "ALTA",
                                "tipo": "T8 SEM ND",
                                "data": str(nd_day),
                                "funcionario": funcionario,
                                "detalhe": "Após dois T8 consecutivos, o terceiro dia precisa ser ND."
                            })
        return issues


class ConsecutiveDaysRule(BaseRule):
    """Garante limite máximo de 6 dias de trabalho consecutivos para funcionários normais."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        planned_validation = {}
        for _, item in sched.iterrows():
            planned_validation[(int(item["funcionario_id"]), pd.to_datetime(item["data"]).date())] = item["turno"]

        if year and month:
            cont_df = validate_previous_month_continuity(year, month)
            if not cont_df.empty:
                for _, r in cont_df.iterrows():
                    issues.append(r.to_dict())

        for funcionario, df_f in sched.groupby("funcionario"):
            if not df_f.empty:
                emp_id = df_f.iloc[0]["funcionario_id"]
                if role_map.get(int(emp_id)) == "PAO FCF":
                    continue
            dates = sorted(pd.to_datetime(df_f["data"]).dt.date.unique())
            for d in dates:
                if start_date and end_date and not (start_date <= d <= end_date):
                    continue
                prev_count = consecutive_work_count(int(emp_id), d, planned_validation)
                if prev_count >= 6:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "MAIS DE 6 DIAS",
                        "data": str(d),
                        "funcionario": funcionario,
                        "detalhe": f"Funcionário com {prev_count + 1} dias consecutivos de trabalho (cruzando limite do mês anterior)."
                    })
        return issues


class WeekendShiftRule(BaseRule):
    """Garante que turnos marcados com restrição de fim de semana (no_fds) não sejam alocados em sábados/domingos."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        for _, item in sched.iterrows():
            sh = item["turno"]
            if sh in shift_map and shift_map[sh].get("no_fds", 0) == 1:
                work_day = pd.to_datetime(item["data"]).date()
                if start_date and end_date and not (start_date <= work_day <= end_date):
                    continue
                if work_day.weekday() >= 5:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "TURNO EM FIM DE SEMANA",
                        "data": str(item["data"]),
                        "funcionario": item["funcionario"],
                        "detalhe": f"Turno {sh} configurado para não alocar em fins de semana, mas escalado no fim de semana."
                    })
        return issues


class ApaoAvailabilityRule(BaseRule):
    """Garante que exista pelo menos 1 APAO disponível diariamente no escritório."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues
        
        apao_avail = apao_available_count_by_day(year, month)
        if not apao_avail.empty:
            for _, ar in apao_avail.iterrows():
                if int(ar["apao_disponiveis"]) < 1:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "SEM APAO DISPONÍVEL",
                        "data": str(ar["data"]),
                        "funcionario": "-",
                        "detalhe": "Todos os APAOs estão folgando/bloqueados neste dia. Regra: sempre deve haver pelo menos 1 APAO disponível."
                    })

        apao_block_day = apao_block_count_by_day(year, month)
        if not apao_block_day.empty:
            for _, rr in apao_block_day.iterrows():
                if int(rr["qtd_apao_bloqueado"]) > 1:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "APAO INDISPONÍVEL EM DUPLICIDADE",
                        "data": str(rr["data"]),
                        "funcionario": "-",
                        "detalhe": f"{int(rr['qtd_apao_bloqueado'])} APAOs indisponíveis no mesmo dia. Regra: sempre deve sobrar pelo menos 1 APAO disponível."
                    })
        return issues


class WorkBlockLengthRule(BaseRule):
    """Garante que os blocos de trabalho consecutivos tenham duração mínima recomendada de 3 dias."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        for funcionario, df_f in sched.groupby("funcionario"):
            if not df_f.empty:
                emp_id = df_f.iloc[0]["funcionario_id"]
                if role_map.get(int(emp_id)) == "PAO FCF":
                    continue
            dates = sorted(pd.to_datetime(df_f["data"]).dt.date.unique())
            if not dates:
                continue

            blocks = []
            start_block = dates[0]
            prev = dates[0]

            for d in dates[1:]:
                if d == prev + timedelta(days=1):
                    prev = d
                else:
                    blocks.append((start_block, prev))
                    start_block = d
                    prev = d
            blocks.append((start_block, prev))

            for b_start, b_end in blocks:
                length = (b_end - b_start).days + 1
                if length < 3:
                    if start_date and end_date and not (start_date <= b_start <= end_date):
                        continue
                    issues.append({
                        "gravidade": "MÉDIA",
                        "tipo": "BLOCO MENOR QUE 3",
                        "data": str(b_start),
                        "funcionario": funcionario,
                        "detalhe": f"Bloco de trabalho com apenas {length} dia(s). Critério mínimo desejado: 3 dias consecutivos."
                    })
        return issues


class Apao6x1Rule(BaseRule):
    """Garante que estagiários APAO não trabalhem 7 dias consecutivos (cumpram escala 6x1)."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues
        apao_sched = sched[sched["cargo"] == "APAO"]
        for funcionario, df_f in apao_sched.groupby("funcionario"):
            dates = sorted(pd.to_datetime(df_f["data"]).dt.date.unique())
            streak = 1
            for i in range(1, len(dates)):
                if dates[i] == dates[i-1] + timedelta(days=1):
                    streak += 1
                    if streak >= 7:
                        if start_date and end_date and not (start_date <= dates[i] <= end_date):
                            continue
                        issues.append({
                            "gravidade": "ALTA",
                            "tipo": "APAO SEM FOLGA 6x1",
                            "data": str(dates[i]),
                            "funcionario": funcionario,
                            "detalhe": "APAO trabalhou 7 dias consecutivos. Regra: 6 trabalhados para 1 folga."
                        })
                else:
                    streak = 1
        return issues


class PaoFcfMetaRule(BaseRule):
    """Garante metas rígidas para PAO FCF (exatamente 10 folgas e exatamente 20 turnos de escala/atividades)."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        if start_date and end_date:
            alloc_month = alloc[(pd.to_datetime(alloc["data"]).dt.date >= start_date) & (pd.to_datetime(alloc["data"]).dt.date <= end_date)] if not alloc.empty else pd.DataFrame()
            sched_month = sched[(pd.to_datetime(sched["data"]).dt.date >= start_date) & (pd.to_datetime(sched["data"]).dt.date <= end_date)] if not sched.empty else pd.DataFrame()
        else:
            alloc_month = alloc
            sched_month = sched

        emp = employees_df()
        for _, e in emp.iterrows():
            if e.cargo != "PAO FCF":
                continue
            emp_id = int(e["id"])
            if not is_employee_planning_active_month(emp_id, year, month):
                continue
            alloc_e = alloc_month[alloc_month["funcionario"] == e.nome] if not alloc_month.empty else pd.DataFrame()
            
            # 1. Meta de exatamente 10 folgas no mês
            folgas = alloc_e[alloc_e["tipo"].isin(["FOLGA", "FOLGA SOCIAL", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO"])] if not alloc_e.empty else pd.DataFrame()
            total_folgas = len(folgas)
            if total_folgas != 10:
                issues.append({
                    "gravidade": "MÉDIA",
                    "tipo": "META PAO FCF - FOLGAS",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e.nome,
                    "detalhe": f"Funcionário possui {total_folgas} folga(s) no mês. O cargo PAO FCF exige exatamente 10 folgas."
                })
            
            # 2. Meta de exatamente 20 turnos (ajustada: 20 − ND)
            work_count = 0
            if not sched_month.empty:
                work_count = len(sched_month[sched_month["funcionario"] == e.nome])
            
            extra_types = {"SIMULADOR", "CURSO ONLINE", "VOO", "CMA"}
            extra_count = len(alloc_e[alloc_e["tipo"].str.upper().isin(extra_types)]) if not alloc_e.empty else 0
            worked_shifts = work_count + extra_count
            nd_n = employee_nd_count(emp_id, year, month)
            target = employee_productive_target(emp_id, year, month)
            if worked_shifts != target:
                issues.append({
                    "gravidade": "MÉDIA",
                    "tipo": "META PAO FCF - TURNOS TRABALHADOS",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e.nome,
                    "detalhe": (
                        f"Possui {worked_shifts} dia(s) produtivo(s) "
                        f"(meta {target} = 20 − {nd_n} ND)."
                    ),
                })
        return issues


class RequestedOffLimitRule(BaseRule):
    """Garante limite máximo de 3 folgas pedidas ou escolhidas por mês por funcionário regular."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        if start_date and end_date:
            alloc_month = alloc[(pd.to_datetime(alloc["data"]).dt.date >= start_date) & (pd.to_datetime(alloc["data"]).dt.date <= end_date)] if not alloc.empty else pd.DataFrame()
        else:
            alloc_month = alloc

        emp = employees_df()
        for _, e in emp.iterrows():
            if e.cargo == "PAO FCF":
                continue
            alloc_e = alloc_month[alloc_month["funcionario"] == e.nome] if not alloc_month.empty else pd.DataFrame()
            folgas_escolhidas = alloc_e[alloc_e["tipo"].isin(["FOLGA PEDIDA", "FOLGA ESCOLHIDA"])] if not alloc_e.empty else pd.DataFrame()
            if len(folgas_escolhidas) > 3:
                issues.append({
                    "gravidade": "MÉDIA",
                    "tipo": "FOLGAS PEDIDAS",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e.nome,
                    "detalhe": f"{len(folgas_escolhidas)} folgas pedidas. Máximo permitido: 3."
                })
        return issues


class PaoOffLimitRule(BaseRule):
    """Inviolável: exatamente 10 folgas mensais para PAO (estilo planilha)."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        if start_date and end_date:
            alloc_month = alloc[(pd.to_datetime(alloc["data"]).dt.date >= start_date) & (pd.to_datetime(alloc["data"]).dt.date <= end_date)] if not alloc.empty else pd.DataFrame()
        else:
            alloc_month = alloc

        rest_types = [
            "FOLGA", "FOLGA SOCIAL", "FOLGA PEDIDA", "FOLGA ESCOLHIDA",
            "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
        ]
        emp = employees_df()
        for _, e in emp.iterrows():
            if e.cargo != "PAO":
                continue
            emp_id = int(e["id"])
            if not is_employee_planning_active_month(emp_id, year, month):
                continue
            alloc_e = alloc_month[alloc_month["funcionario"] == e.nome] if not alloc_month.empty else pd.DataFrame()
            folgas = alloc_e[alloc_e["tipo"].isin(rest_types)] if not alloc_e.empty else pd.DataFrame()
            n = len(folgas)
            if n != 10:
                issues.append({
                    "gravidade": "ALTA",
                    "tipo": "FOLGAS PAO",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e.nome,
                    "detalhe": f"{n} folgas no mês. Regra inviolável da planilha: exatamente 10."
                })
        return issues


class SocialOffPresenceRule(BaseRule):
    """Sinaliza como aviso funcionários regulares que não possuem pelo menos uma Folga Social ou Agrupada no mês."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        if start_date and end_date:
            alloc_month = alloc[(pd.to_datetime(alloc["data"]).dt.date >= start_date) & (pd.to_datetime(alloc["data"]).dt.date <= end_date)] if not alloc.empty else pd.DataFrame()
        else:
            alloc_month = alloc

        emp = employees_df()
        for _, e in emp.iterrows():
            if e.cargo == "PAO FCF":
                continue
            emp_id = int(e["id"])
            if not is_employee_planning_active_month(emp_id, year, month):
                continue
            alloc_e = alloc_month[alloc_month["funcionario"] == e.nome] if not alloc_month.empty else pd.DataFrame()
            social = alloc_e[alloc_e["tipo"].isin(["FOLGA SOCIAL", "FOLGA AGRUPADA"])] if not alloc_e.empty else pd.DataFrame()
            if social.empty:
                issues.append({
                    "gravidade": "BAIXA",
                    "tipo": "SEM FOLGA SOCIAL/AGRUPADA",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e.nome,
                    "detalhe": "Funcionário ainda não possui folga social ou agrupada lançada no mês."
                })
        return issues


class MonofolgaRule(BaseRule):
    """Sinaliza folgas isoladas de 1 único dia (monofolgas), recomendando agrupamento com outros descansos."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues
        emp = employees_df()
        for _, e in emp.iterrows():
            if e.cargo == "PAO FCF":
                continue
            emp_id = int(e["id"])
            if not is_employee_planning_active_month(emp_id, year, month):
                continue
            alloc_e = alloc[alloc["funcionario"] == e.nome] if not alloc.empty else pd.DataFrame()
            folgas = alloc_e[alloc_e["tipo"].isin(["FOLGA", "FOLGA SOCIAL", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO"])] if not alloc_e.empty else pd.DataFrame()
            if not folgas.empty:
                rest_dates = sorted(pd.to_datetime(folgas["data"]).dt.date.unique())
                rest_set = set(rest_dates)
                for rd in rest_dates:
                    if start_date and end_date and not (start_date <= rd <= end_date):
                        continue
                    if (rd - timedelta(days=1)) not in rest_set and (rd + timedelta(days=1)) not in rest_set:
                        issues.append({
                            "gravidade": "MÉDIA",
                            "tipo": "MONOFOLGA",
                            "data": str(rd),
                            "funcionario": e.nome,
                            "detalhe": "Folga isolada de apenas 1 dia. Preferir folga agrupada/consecutiva."
                        })
        return issues


class PaoFcfConcurrencyRule(BaseRule):
    """Garante que não existam dois ou mais funcionários PAO FCF trabalhando ou ativos no mesmo dia."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        for d in iter_days(year, month):
            day_str = str(d)
            active_fcf = {}

            # 1. Planned assignments
            if not sched.empty:
                day_sched = sched[sched["data"] == day_str]
                for _, row in day_sched.iterrows():
                    emp_id = int(row["funcionario_id"])
                    if role_map.get(emp_id) == "PAO FCF" and row["turno"]:
                        active_fcf[emp_id] = (row["funcionario"], f"turno {row['turno']}")

            # 2. Blocked working activities
            if not alloc.empty:
                day_alloc = alloc[alloc["data"] == day_str]
                for _, row in day_alloc.iterrows():
                    emp_id = int(row["funcionario_id"])
                    if role_map.get(emp_id) == "PAO FCF":
                        alloc_type = str(row["tipo"]).upper()
                        if alloc_type in ["SIMULADOR", "CURSO ONLINE", "VOO"]:
                            active_fcf[emp_id] = (row["funcionario"], alloc_type)

            if len(active_fcf) > 1:
                names_details = ", ".join([f"{name} ({detail})" for name, detail in active_fcf.values()])
                for emp_id, (name, detail) in active_fcf.items():
                    issues.append({
                        "gravidade": "CRÍTICA",
                        "tipo": "CONCORRÊNCIA PAO FCF",
                        "data": day_str,
                        "funcionario": name,
                        "detalhe": f"Concorrência de múltiplos PAO FCF no mesmo dia: {names_details}."
                    })
        return issues


class PaoAllowedShiftsRule(BaseRule):
    """Garante que funcionários PAO regular trabalhem apenas em T6, T7, T8."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if sched.empty:
            return issues

        for _, row in sched.iterrows():
            emp_id = int(row["funcionario_id"])
            role = role_map.get(emp_id)
            if role == "PAO":
                shift_code = str(row["turno"]).upper()
                if shift_code in {"T1", "T2", "T3", "T4"}:
                    issues.append({
                        "gravidade": "CRÍTICA",
                        "tipo": "TURNO APAO COBERTO POR PAO REGULAR",
                        "data": str(row["data"]),
                        "funcionario": row["funcionario"],
                        "detalhe": f"Piloto PAO regular escalado em turno de APAO ({shift_code})."
                    })
                elif shift_code not in {"T6", "T7", "T8"}:
                    issues.append({
                        "gravidade": "CRÍTICA",
                        "tipo": "TURNO NÃO PERMITIDO PARA PAO",
                        "data": str(row["data"]),
                        "funcionario": row["funcionario"],
                        "detalhe": f"Piloto PAO regular escalado em turno inválido ({shift_code}). Somente T6, T7 e T8 são permitidos."
                    })
        return issues


class T8GroupingPresenceRule(BaseRule):
    """Garante que todo piloto ativo PAO e PAO FCF tenha pelo menos um agrupamento T8/T8/ND no mês, exceto se restrito."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        emp = employees_df()
        restr_df = shift_restrictions_df(year, month) if year and month else pd.DataFrame()

        # Filtrar apenas funcionários das carreiras PAO e PAO FCF
        target_emps = emp[emp["cargo"].isin(["PAO", "PAO FCF"])]
        if target_emps.empty:
            return issues

        t8 = sched[sched["turno"] == "T8"] if not sched.empty else pd.DataFrame()
        alloc_nd = alloc[alloc["tipo"] == "ND"] if not alloc.empty else pd.DataFrame()

        for _, e in target_emps.iterrows():
            emp_id = int(e["id"])

            if not is_employee_planning_active_month(emp_id, year, month):
                continue

            # Exclui pilotos com turno fixo diferente de T8
            is_fixed = int(e.get("fixo", 0) or 0) == 1
            fixed_shift = str(e.get("turno_fixo", "") or "").upper().strip()
            if is_fixed and fixed_shift != "T8" and fixed_shift != "":
                continue

            # Verificar se o piloto possui restrição no turno T8
            restricted_t8 = False
            if not restr_df.empty:
                emp_restr = restr_df[(restr_df["funcionario_id"] == emp_id) & (restr_df["turno_bloqueado"] == "T8")]
                if not emp_restr.empty:
                    restricted_t8 = True

            if restricted_t8:
                continue

            # Verificar se tem pelo menos um bloco T8/T8/ND
            emp_t8 = t8[t8["funcionario_id"] == emp_id] if not t8.empty else pd.DataFrame()
            if emp_t8.empty:
                issues.append({
                    "gravidade": "ALTA",
                    "tipo": "FALTA BLOCO T8/T8/ND",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e["nome"],
                    "detalhe": "Piloto elegível sem nenhum bloco T8/T8/ND no mês.",
                })
                continue

            dates = sorted(pd.to_datetime(emp_t8["data"]).dt.date.unique())
            dates_set = set(dates)

            has_grouping = False
            for d in dates:
                if (d + timedelta(days=1)) in dates_set:
                    nd_day = d + timedelta(days=2)
                    nd_match = False
                    if not alloc_nd.empty:
                        nd_match_df = alloc_nd[
                            (alloc_nd["funcionario_id"] == emp_id) &
                            (pd.to_datetime(alloc_nd["data"]).dt.date == nd_day)
                        ]
                        nd_match = not nd_match_df.empty

                    if nd_match:
                        has_grouping = True
                        break

            if not has_grouping:
                issues.append({
                    "gravidade": "ALTA",
                    "tipo": "FALTA GRUPO T8/T8/ND",
                    "data": f"{month:02d}/{year}",
                    "funcionario": e.nome,
                    "detalhe": f"Funcionário ativo {e.cargo} não possui nenhum agrupamento T8/T8/ND completo no mês."
                })

        return issues


class FortnightGroupRule(BaseRule):
    """Garante rotação por blocos ~10 dias (Grupo A/B/C — substitui quinzena)."""
    def validate(self, year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map):
        issues = []
        if not (year and month):
            return issues

        from core.scheduler import get_block_group, _pilot_shift_block_days, _pilot_off_block_days

        if not sched.empty:
            for _, row in sched.iterrows():
                emp_id = int(row["funcionario_id"])
                role = role_map.get(emp_id)
                if role != "PAO":
                    continue
                work_day = pd.to_datetime(row["data"]).date()
                if start_date and end_date and not (start_date <= work_day <= end_date):
                    continue
                shift_code = str(row["turno"]).upper()
                if shift_code not in {"T6", "T7", "T8"}:
                    continue
                grp = get_block_group(emp_id, year, month)
                if not grp:
                    continue
                off_days = _pilot_off_block_days(emp_id, year, month, include_fixed=False)
                if work_day in off_days:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "DESVIO DE BLOCO (TURNO)",
                        "data": str(row["data"]),
                        "funcionario": row["funcionario"],
                        "detalhe": f"Piloto Grupo {grp} com turno {shift_code} em bloco off (deveria VOO/folga).",
                    })

        if not alloc.empty:
            voos = alloc[alloc["tipo"] == "VOO"]
            for _, row in voos.iterrows():
                emp_id = int(row["funcionario_id"])
                role = role_map.get(emp_id)
                if role != "PAO":
                    continue
                work_day = pd.to_datetime(row["data"]).date()
                if start_date and end_date and not (start_date <= work_day <= end_date):
                    continue
                grp = get_block_group(emp_id, year, month)
                if not grp:
                    continue
                shift_days = _pilot_shift_block_days(emp_id, year, month, include_fixed=False)
                if work_day in shift_days:
                    issues.append({
                        "gravidade": "ALTA",
                        "tipo": "DESVIO DE BLOCO (VOO)",
                        "data": str(row["data"]),
                        "funcionario": row["funcionario"],
                        "detalhe": f"Piloto Grupo {grp} em VOO no bloco de turno (~10 dias).",
                    })

        return issues


def validate_rules(year=None, month=None):
    """Executa auditoria abrangente da escala rodando todas as especificações modulares de regras."""
    if year and month:
        start_date, end_date = month_range(year, month)
        load_start = start_date - timedelta(days=5)
        load_end = end_date + timedelta(days=5)
    else:
        start_date = end_date = None
        load_start = load_end = None

    sched = schedule_df(load_start, load_end)
    alloc = allocations_df(load_start, load_end)
    shifts = shifts_df()

    if sched.empty and alloc.empty:
        return pd.DataFrame(columns=["gravidade", "tipo", "data", "funcionario", "detalhe"])

    role_map = build_employee_role_map()
    shift_map = build_shift_time_map()

    rules = [
        ShiftCapacityRule(),
        DuplicityRule(),
        Rest12hRule(),
        SimultaneousStationsRule(),
        BlockedShiftRule(),
        ApaoCompanionRule(),
        BlockedDayWorkRule(),
        T8PairingRule(),
        ConsecutiveDaysRule(),
        WeekendShiftRule(),
        ApaoAvailabilityRule(),
        WorkBlockLengthRule(),
        Apao6x1Rule(),
        PaoFcfMetaRule(),
        RequestedOffLimitRule(),
        PaoOffLimitRule(),
        SocialOffPresenceRule(),
        MonofolgaRule(),
        PaoFcfConcurrencyRule(),
        PaoAllowedShiftsRule(),
        T8GroupingPresenceRule(),
        FortnightGroupRule()
    ]

    issues = []
    for rule in rules:
        issues.extend(rule.validate(year, month, start_date, end_date, sched, alloc, shifts, role_map, shift_map))

    return pd.DataFrame(issues)

def employee_monthly_summary(year, month):
    """Calcula estatísticas de turnos, folgas e alocações mensais de cada funcionário."""
    start_date, end_date = month_range(year, month)
    emp = employees_df()
    sched = schedule_df(start_date, end_date)
    alloc = allocations_df(start_date, end_date)

    rows = []
    for _, e in emp.iterrows():
        nome = e["nome"]
        cargo = e["cargo"]

        work_count = 0
        if not sched.empty:
            work_count = len(sched[sched["funcionario"] == nome])

        folga = folga_pedida = social = agrupada = aniversario = 0
        ferias = simulador = voo = curso = cma = nd = 0

        if not alloc.empty:
            a = alloc[alloc["funcionario"] == nome]
            folga = len(a[a["tipo"] == "FOLGA"])
            folga_pedida = len(a[a["tipo"].isin(["FOLGA PEDIDA", "FOLGA ESCOLHIDA"])])
            social = len(a[a["tipo"] == "FOLGA SOCIAL"])
            agrupada = len(a[a["tipo"] == "FOLGA AGRUPADA"])
            aniversario = len(a[a["tipo"] == "FOLGA ANIVERSÁRIO"])
            ferias = len(a[a["tipo"] == "FÉRIAS"])
            simulador = len(a[a["tipo"] == "SIMULADOR"])
            voo = len(a[a["tipo"] == "VOO"])
            curso = len(a[a["tipo"] == "CURSO ONLINE"])
            cma = len(a[a["tipo"] == "CMA"])
            nd = len(a[a["tipo"] == "ND"])

        extra_productive = simulador + voo + curso + cma
        if cargo in ("PAO", "PAO FCF"):
            work_count = work_count + extra_productive

        total_folgas = folga + folga_pedida + social + agrupada + aniversario
        eid = int(e["id"])
        meta_produtivo = employee_productive_target(eid, year, month) if cargo in ("PAO", "PAO FCF") else work_count
        rows.append({
            "cargo": cargo,
            "senioridade": e["senioridade"],
            "funcionario": nome,
            "turnos_trabalhados": work_count,
            "total_produtivo": work_count,
            "meta_produtivo": meta_produtivo,
            "folgas": total_folgas,
            "folga": folga,
            "folga_pedida": folga_pedida,
            "folga_social": social,
            "folga_agrupada": agrupada,
            "folga_aniversario": aniversario,
            "total_folgas": total_folgas,
            "ferias": ferias,
            "simulador": simulador,
            "voo": voo,
            "curso": curso,
            "cma": cma,
            "nd": nd,
        })

    return pd.DataFrame(rows)

def schedule_intervals_for_month(year, month):
    """Calcula os intervalos de datetimes de cada turno alocado na escala no mês."""
    start_date, end_date = month_range(year, month)
    sched = schedule_df(start_date, end_date)
    shift_map = build_shift_time_map()
    intervals = []

    if sched.empty:
        return intervals

    for _, item in sched.iterrows():
        turno = item["turno"]
        if turno not in shift_map:
            continue

        work_day = pd.to_datetime(item["data"]).date()
        start_dt, end_dt = shift_start_end_datetimes(
            work_day,
            shift_map[turno]["inicio"],
            shift_map[turno]["fim"]
        )

        intervals.append({
            "data": work_day,
            "inicio_dt": start_dt,
            "fim_dt": end_dt,
            "funcionario": item["funcionario"],
            "cargo": item["cargo"],
            "turno": turno
        })

    return intervals

def coverage_dataframe(year, month):
    """Monta mapa de cobertura do mês por janelas de eventos reais."""
    intervals = schedule_intervals_for_month(year, month)
    rows = []

    for day in iter_days(year, month):
        day_start = datetime.combine(day, datetime.min.time())
        day_end = day_start + timedelta(days=1)

        points = {day_start, day_end}

        for it in intervals:
            if it["fim_dt"] > day_start and it["inicio_dt"] < day_end:
                points.add(max(it["inicio_dt"], day_start))
                points.add(min(it["fim_dt"], day_end))

        points = sorted(points)

        for a, b in zip(points[:-1], points[1:]):
            if a == b:
                continue

            active = []
            for it in intervals:
                if it["inicio_dt"] < b and it["fim_dt"] > a:
                    active.append(it)

            active_for_limit = [x for x in active if str(x["turno"]).strip().upper() not in ("T9", "T09") and x["cargo"] != "PAO FCF"]
            pao = [x for x in active if x["cargo"] == "PAO"]
            apao = [x for x in active if x["cargo"] == "APAO"]

            status = "OK"
            detalhes = []

            if len(pao) < 1:
                status = "ERRO"
                detalhes.append("sem PAO")
            if len(active_for_limit) > 2:
                status = "ERRO"
                detalhes.append("mais de 2 estações")
            if len(apao) > 0 and len(pao) < 1:
                status = "ERRO"
                detalhes.append("APAO sem PAO")
            if len(apao) > 1:
                status = "ERRO"
                detalhes.append("mais de 1 APAO simultâneo")

            rows.append({
                "data": str(day),
                "inicio": a.strftime("%H:%M"),
                "fim": b.strftime("%H:%M"),
                "qtd_total": len(active_for_limit),
                "qtd_pao": len(pao),
                "qtd_apao": len(apao),
                "pao": ", ".join([f"{x['funcionario']}({x['turno']})" for x in pao]),
                "apao": ", ".join([f"{x['funcionario']}({x['turno']})" for x in apao]),
                "status": status,
                "detalhe": "; ".join(detalhes)
            })

    return pd.DataFrame(rows)

def coverage_issues_df(year, month):
    """Filtra apenas os problemas ou furos de cobertura encontrados no mês."""
    df = coverage_dataframe(year, month)
    if df.empty:
        return pd.DataFrame(columns=["gravidade", "tipo", "data", "inicio", "fim", "detalhe"])

    issues = []
    bad = df[df["status"] != "OK"]

    for _, r in bad.iterrows():
        tipo = "COBERTURA HORÁRIA"
        gravidade = "ALTA"

        if "sem PAO" in r["detalhe"]:
            tipo = "SEM PAO"
        elif "mais de 2 estações" in r["detalhe"]:
            tipo = "MAIS DE 2 ESTAÇÕES"
        elif "mais de 1 APAO" in r["detalhe"]:
            tipo = "APAO DUPLO"

        issues.append({
            "gravidade": gravidade,
            "tipo": tipo,
            "data": r["data"],
            "inicio": r["inicio"],
            "fim": r["fim"],
            "detalhe": r["detalhe"]
        })

    return pd.DataFrame(issues)

def self_diagnostic_df(year, month):
    """Resumo de diagnóstico automático da escala do mês."""
    issues_rules = validate_rules(year, month)
    issues_cov = coverage_issues_df(year, month)

    rows = []

    rows.append({
        "teste": "Validação de regras",
        "resultado": "OK" if issues_rules.empty else "REVISAR",
        "achados": int(len(issues_rules))
    })

    rows.append({
        "teste": "Cobertura horária 24h",
        "resultado": "OK" if issues_cov.empty else "REVISAR",
        "achados": int(len(issues_cov))
    })

    # T8 diário
    sched = schedule_df(*month_range(year, month))
    t8_missing = 0
    if not sched.empty:
        for d in iter_days(year, month):
            day_sched = sched[(sched["data"] == str(d)) & (sched["turno"] == "T8")]
            if day_sched.empty:
                t8_missing += 1
    else:
        t8_missing = calendar.monthrange(year, month)[1]

    rows.append({
        "teste": "T8 diário",
        "resultado": "OK" if t8_missing == 0 else "REVISAR",
        "achados": int(t8_missing)
    })

    # APAO 6x1
    apao_issues = 0
    if not issues_rules.empty and "tipo" in issues_rules.columns:
        apao_issues = len(issues_rules[issues_rules["tipo"].astype(str).str.contains("APAO", na=False)])

    rows.append({
        "teste": "APAO 6x1",
        "resultado": "OK" if apao_issues == 0 else "REVISAR",
        "achados": int(apao_issues)
    })

    return pd.DataFrame(rows)

def generate_fix_suggestions(year, month):
    """Gera sugestões práticas detalhadas para ajudar a resolver falhas e otimizar a escala do mês."""
    from services.exporter_pdf import build_visual_schedule_dataframe
    suggestions = []

    cov = coverage_issues_df(year, month)
    rules = validate_rules(year, month)
    summary = employee_monthly_summary(year, month)

    if not cov.empty:
        for _, r in cov.head(30).iterrows():
            detalhe = str(r.get("detalhe", ""))
            inicio = r.get("inicio", "")
            fim = r.get("fim", "")
            data = r.get("data", "")

            if "sem PAO" in detalhe:
                suggestions.append({
                    "prioridade": "ALTA",
                    "data": data,
                    "janela": f"{inicio}-{fim}",
                    "problema": "Sem PAO cobrindo a janela",
                    "sugestão": "Tente liberar um PAO neste período, reduzir bloqueios/férias/FP, ou mover um PAO de outro turno mantendo descanso de 12h."
                })
            elif "mais de 2 estações" in detalhe:
                suggestions.append({
                    "prioridade": "ALTA",
                    "data": data,
                    "janela": f"{inicio}-{fim}",
                    "problema": "Mais de 2 funcionários simultâneos",
                    "sugestão": "Remova ou mova um APAO/PAO desta janela. O limite físico do escritório é 2 pessoas."
                })
            elif "APAO sem PAO" in detalhe:
                suggestions.append({
                    "prioridade": "ALTA",
                    "data": data,
                    "janela": f"{inicio}-{fim}",
                    "problema": "APAO sem acompanhamento",
                    "sugestão": "Mova o APAO para uma janela coberta por PAO ou ajuste o PAO para cobrir integralmente o turno do APAO."
                })
            elif "mais de 1 APAO" in detalhe:
                suggestions.append({
                    "prioridade": "ALTA",
                    "data": data,
                    "janela": f"{inicio}-{fim}",
                    "problema": "Dois APAOs simultâneos",
                    "sugestão": "Mantenha apenas um APAO na janela e mova o outro para outro turno/dia."
                })

    if not rules.empty:
        for _, r in rules.head(30).iterrows():
            tipo = str(r.get("tipo", ""))
            data = str(r.get("data", ""))
            funcionario = str(r.get("funcionario", "-"))

            sugestao = "Revise manualmente pela Escala Visual ou Escala Manual."
            if "T8" in tipo:
                sugestao = "Mantenha o padrão T8,T8,ND. Se faltar cobertura, tente mudar outro PAO para iniciar um bloco T8 em dia diferente."
            elif "MONOFOLGA" in tipo:
                sugestao = "Agrupe a folga com o dia anterior ou posterior para evitar folga isolada."
            elif "BLOCO MENOR QUE 3" in tipo:
                sugestao = "Tente manter o funcionário por pelo menos 3 dias consecutivos antes da próxima folga/bloqueio."
            elif "APAO" in tipo:
                sugestao = "Garanta 6 dias trabalhados e 1 folga, sempre com PAO acompanhando."

            suggestions.append({
                "prioridade": str(r.get("gravidade", "MÉDIA")),
                "data": data,
                "janela": "-",
                "problema": f"{tipo} - {funcionario}",
                "sugestão": sugestao
            })

    # APAO com escala pouco preenchida
    if not summary.empty:
        apao_summary = summary[summary["cargo"] == "APAO"]
        for _, a in apao_summary.iterrows():
            if int(a["turnos_trabalhados"]) < 20:
                suggestions.append({
                    "prioridade": "MÉDIA",
                    "data": "-",
                    "janela": "-",
                    "problema": f"APAO com baixa ocupação - {a['funcionario']}",
                    "sugestão": "Verifique restrições, folgas e janelas com PAO. APAO só pode entrar se houver PAO cobrindo todo o período e limite de 2 pessoas."
                })

    # Sugestão baseada em resumo: quem ainda pode trabalhar mais
    if not summary.empty:
        candidates = summary.sort_values(["turnos_trabalhados", "total_folgas"], ascending=[True, False]).head(5)
        for _, c in candidates.iterrows():
            suggestions.append({
                "prioridade": "INFO",
                "data": "-",
                "janela": "-",
                "problema": f"{c['funcionario']} com {c['turnos_trabalhados']} turnos e {c['total_folgas']} folgas",
                "sugestão": "Pode ser candidato para receber mais turnos, desde que respeite descanso, cargo, APAO com PAO e limite de 2 estações."
            })

    if not suggestions:
        suggestions.append({
            "prioridade": "OK",
            "data": "-",
            "janela": "-",
            "problema": "Nenhum problema relevante encontrado",
            "sugestão": "A escala parece consistente nas validações atuais."
        })

    suggestions.append({
        "prioridade": "REGRA",
        "data": "-",
        "janela": "-",
        "problema": "APAO é tratado como estagiário",
        "sugestão": "APAO nunca deve ficar sozinho: precisa de PAO cobrindo todo o período e o escritório não pode passar de 2 pessoas simultâneas."
    })

    # APAO com células vazias na escala visual.
    try:
        vdf = build_visual_schedule_dataframe(year, month)
        if not vdf.empty:
            day_cols = [c for c in vdf.columns if is_visual_day_column(c)]
            if len(day_cols) > 1:
                day_cols = day_cols[1:]
            apao_rows = vdf[vdf["Cargo"] == "APAO"]
            for _, ar in apao_rows.iterrows():
                emp_match = employees_df("APAO")
                emp_match = emp_match[emp_match["nome"] == ar["Funcionário"]] if not emp_match.empty else emp_match
                emp_id = int(emp_match.iloc[0]["id"]) if not emp_match.empty else None

                blanks = []
                for c in day_cols:
                    if str(ar.get(c, "")).strip():
                        continue
                    try:
                        d = date(int(year), int(month), int(str(c).strip()))
                    except Exception:
                        continue
                    if emp_id is not None and is_employee_on_vacation(emp_id, d):
                        continue
                    blanks.append(c)

                if blanks:
                    suggestions.append({
                        "prioridade": "ALTA",
                        "data": "-",
                        "janela": "-",
                        "problema": f"APAO com célula vazia - {ar['Funcionário']}",
                        "sugestão": f"APAO está sem preenchimento nos dias: {', '.join(map(str, blanks[:10]))}. Use o botão 'APAO integrado à geração automática' na Escala Interativa ou ajuste manualmente."
                    })
    except Exception:
        pass

    return pd.DataFrame(suggestions)



