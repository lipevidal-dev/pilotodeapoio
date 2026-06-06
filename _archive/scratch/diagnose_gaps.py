import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pandas as pd
from core.rules import month_range, iter_days
from database.repositories import employees_df, schedule_df, allocations_df
from services.schedule_service import ScheduleService
from core.scheduler import get_block_group, _pilot_off_block_days, _pilot_shift_block_days, can_work, build_shift_restriction_map
from core.rules import build_shift_time_map

Y, M = 2026, 6
start, end = month_range(Y, M)
sched = schedule_df(start, end)
alloc = allocations_df(start, end)
gaps = ScheduleService.crosscheck_operational_gaps(Y, M)

print("=== FUROS", len(gaps), "===")
if not gaps.empty:
    print(gaps.groupby(["problema", "turno"]).size())
    print("\nDias piores:")
    print(gaps.groupby("data").size().sort_values(ascending=False).head(12))

print("\n=== DIAS SEM COBERTURA COMPLETA ===")
for d in iter_days(Y, M):
    parts = []
    for sh in ["T6", "T7", "T8"]:
        if sched.empty:
            n = 0
        else:
            n = len(sched[(pd.to_datetime(sched["data"]).dt.date == d) & (sched["turno"] == sh) & (sched["cargo"] == "PAO")])
        parts.append(f"{sh}={n}")
    if any(p != "T6=1" and p != "T7=1" and p != "T8=1" for p in parts) or parts != ["T6=1", "T7=1", "T8=1"]:
        bad = [p for p in parts if not p.endswith("=1")]
        if bad:
            print(d, " ".join(parts))

print("\n=== PILOTOS ===")
shift_map = build_shift_time_map()
shift_restrictions = build_shift_restriction_map(Y, M)
planned = {}
if not sched.empty:
    for _, r in sched.iterrows():
        planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]
blocked = {}
if not alloc.empty:
    for _, r in alloc.iterrows():
        blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

for _, e in employees_df("PAO").iterrows():
    eid = int(e["id"])
    t = sum(1 for (eid2, d), sh in planned.items() if eid2 == eid and sh)
    grp = get_block_group(eid, Y, M, True)
    off = len(_pilot_off_block_days(eid, Y, M, True))
    print(f"  {e['nome'][:24]:24} grp={grp} turnos={t:2d} off_dias={off:2d} fixo={e.get('fixo',0)}")

# Why gaps on worst day
if not gaps.empty:
    worst = gaps[gaps["problema"] == "SEM COBERTURA DE PAO"].iloc[0]
    d = pd.to_datetime(worst["data"]).date()
    sh = worst["turno"]
    print(f"\n=== POR QUE {sh} FALTA EM {d}? ===")
    for _, e in employees_df("PAO").iterrows():
        ok, reason = can_work(e.to_dict(), d, sh, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, strict=False, allow_fortnight_override=True)
        mark = "OK" if ok else reason[:60]
        print(f"  {e['nome'][:20]:20} {mark}")
