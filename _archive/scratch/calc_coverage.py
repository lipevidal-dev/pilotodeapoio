"""Calcula turnos/piloto necessários para 100% cobertura T6/T7/T8."""
import math
from database.connection import init_db
from database.repositories import employees_df, allocations_df
from core.rules import month_range, iter_days, is_employee_planning_active_month, employee_vacation_dates
from core.scheduler_v2 import diagnose_capacity, PAO_SHIFTS_PER_DAY

init_db()

HARD = {
    "FERIAS", "FÉRIAS", "CURSO ONLINE", "FOLGA PEDIDA", "DISPENSA MÉDICA",
    "SIMULADOR", "ND", "VOO", "CMA", "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA",
    "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
}


def analyze(year: int, month: int) -> None:
    start, end = month_range(year, month)
    days = list(iter_days(year, month))
    n_days = len(days)
    slots = n_days * PAO_SHIFTS_PER_DAY

    pao = employees_df("PAO")
    n_pao = len(pao) if not pao.empty else 0
    n_active = sum(
        1 for _, e in pao.iterrows()
        if is_employee_planning_active_month(int(e["id"]), year, month)
    ) if not pao.empty else 0

    print(f"\n{'='*60}")
    print(f"Mês {month:02d}/{year} — {n_days} dias")
    print(f"Pilotos PAO: {n_pao} ({n_active} ativos no planejamento)")
    print(f"Cobertura/dia: {PAO_SHIFTS_PER_DAY} turnos (T6 + T7 + T8)")
    print(f"Total de slots no mês: {slots}")

    if n_active:
        media = slots / n_active
        print(f"\n--- Divisão igual entre {n_active} pilotos ativos ---")
        print(f"Média para 100%: {media:.1f} turnos/piloto")
        print(f"Mínimo aritmético: {math.ceil(slots / n_active)} turnos/piloto")

    print(f"\n--- Regra do sistema (inviolável) ---")
    print("Folgas: exatamente 10 por piloto")
    print("Produtivos: meta 20 - ND (cada bloco T8/T8/ND consome 1 na meta)")
    print("Teto prático: ~20 turnos T6/T7/T8 por piloto/mês (sem férias)")

    min_pilots = math.ceil(slots / 20) if slots else 0
    print(f"\n--- Pilotos mínimos (20T/piloto, mês ideal) ---")
    print(f"Para {slots} slots: ceil({slots}/20) = {min_pilots} pilotos PAO")

    alloc = allocations_df(start, end)
    if not pao.empty:
        print("\n--- Detalhe por piloto ---")
        total_cap = 0
        for _, e in pao.sort_values("senioridade").iterrows():
            eid = int(e["id"])
            active = is_employee_planning_active_month(eid, year, month)
            vac = len(employee_vacation_dates(eid, year, month))
            blocked = 0
            if not alloc.empty:
                sub = alloc[alloc["funcionario_id"] == eid]
                blocked = sum(1 for _, r in sub.iterrows() if str(r["tipo"]).upper() in HARD)
            avail = (n_days - blocked) if active else 0
            cap = min(20, max(0, avail))
            total_cap += cap
            status = "ativo" if active else "FORA (férias)"
            print(
                f"  sen.{int(e['senioridade']):2d} {e['nome'][:28]:28s} "
                f"{status:12s} bloq={blocked:2d} cap~{cap:2d}T"
            )
        print(f"\nSoma capacidade realista: {total_cap} turnos vs {slots} necessários")
        if total_cap >= slots:
            print("OK: capacidade realista cobre o mês")
        else:
            print(f"FALTA: {slots - total_cap} turnos (~{math.ceil((slots-total_cap)/20)} piloto(s) ou reduzir bloqueios)")

    diag = diagnose_capacity(year, month)
    print(f"\nDiagnóstico: {diag['status_label']} — {diag['message']}")


if __name__ == "__main__":
    analyze(2026, 6)
    analyze(2026, 1)
