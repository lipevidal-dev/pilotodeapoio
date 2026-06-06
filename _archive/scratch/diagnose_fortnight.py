import pandas as pd
from database.repositories import employees_df, schedule_df, allocations_df
from core.scheduler import get_fortnight_group
from core.rules import month_range
from services.schedule_service import ScheduleService

year, month = 2026, 6
start, end = month_range(year, month)
pao = employees_df("PAO")
print("=== PAO por quinzena ===")
for _, e in pao.iterrows():
    g = get_fortnight_group(int(e["id"]), year, month)
    fixo = e.get("turno_fixo", "")
    print(f"  {e['nome']:25} Grupo {g} fixo={fixo}")

v = ScheduleService.viability_summary_df(year, month)
print("\n=== Viabilidade ===")
print(v.to_string(index=False))

alloc = allocations_df(start, end)
sched = schedule_df(start, end)
print("\n=== Grupo A — dias 1-15 (unicos que podem turno) ===")
for _, e in pao.iterrows():
    eid = int(e["id"])
    if get_fortnight_group(eid, year, month) != "A":
        continue
    blocks = []
    if not alloc.empty:
        sub = alloc[(alloc["funcionario_id"] == eid) & (pd.to_datetime(alloc["data"]).dt.day <= 15)]
        for _, r in sub.iterrows():
            blocks.append(f"{str(r['data'])[:10]}:{r['tipo']}")
    works = []
    if not sched.empty:
        sub = sched[(sched["funcionario_id"] == eid) & (pd.to_datetime(sched["data"]).dt.day <= 15)]
        for _, r in sub.iterrows():
            works.append(f"{str(r['data'])[:10]}:{r['turno']}")
    print(f"  {e['nome']:25} turnos={len(works)} bloqueios={len(blocks)}")
    if blocks:
        print("    ", ", ".join(blocks))

print("\n=== Grupo B — bloqueados para turno ate dia 15 ===")
for _, e in pao.iterrows():
    eid = int(e["id"])
    if get_fortnight_group(eid, year, month) != "B":
        continue
    print(f"  {e['nome']}")
