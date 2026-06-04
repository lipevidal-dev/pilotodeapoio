import pandas as pd
from datetime import date, timedelta
from database.repositories import employees_df, schedule_df, allocations_df
from core.rules import consecutive_work_count, month_range

year, month = 2026, 6
start, end = month_range(year, month)
prev = start - timedelta(days=1)

emp = employees_df()
andre = emp[emp["nome"].str.contains("VARELLA", case=False, na=False)].iloc[0]
eid = int(andre["id"])
print("Andre:", andre["nome"], "fixo=", andre.get("turno_fixo"), "id=", eid)

sched = schedule_df(date(2026, 5, 25), end)
sub = sched[sched["funcionario_id"] == eid].sort_values("data")
print("\nTurnos 25/mai a fim jun:")
for _, r in sub.iterrows():
    obs = str(r.get("observacao", ""))[:50]
    print(" ", str(r["data"])[:10], r["turno"], obs)

alloc = allocations_df(date(2026, 5, 25), end)
sub = alloc[alloc["funcionario_id"] == eid].sort_values("data")
print("\nAlocacoes:")
for _, r in sub.iterrows():
    print(" ", str(r["data"])[:10], r["tipo"])

planned = {}
all_s = schedule_df(prev, end)
for _, r in all_s.iterrows():
    planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

for d in [date(2026, 6, 1), date(2026, 6, 10), date(2026, 6, 16), date(2026, 6, 30)]:
    print(f"streak before {d}:", consecutive_work_count(eid, d, planned))

# max consecutive work in june
days = []
for _, r in sub.iterrows():
    pass
sub2 = sched[sched["funcionario_id"] == eid]
work_days = sorted(pd.to_datetime(sub2["data"]).dt.date.tolist())
max_run = run = 1
for i in range(1, len(work_days)):
    if work_days[i] == work_days[i - 1] + timedelta(days=1):
        run += 1
        max_run = max(max_run, run)
    else:
        run = 1
print("Max consecutive work days in june (assignments only):", max_run)
