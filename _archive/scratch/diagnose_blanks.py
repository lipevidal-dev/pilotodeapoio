"""Diagnóstico: folgas, turnos e dias em branco após alocação."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datetime import date
import pandas as pd
from database.connection import set_db_path, DEFAULT_DB_PATH
from database.repositories import employees_df, allocations_df, schedule_df, delete_month_schedule
from core.scheduler import auto_allocate_rests, generate_auto_schedule
from core.rules import month_range, iter_days, employee_monthly_summary
from services.exporter_pdf import build_visual_schedule_dataframe
from ui.components import is_visual_day_column

set_db_path(DEFAULT_DB_PATH)
year, month = 2026, 6
start, end = month_range(year, month)
days = list(iter_days(year, month))

print(f"DB: {DEFAULT_DB_PATH}")
print(f"Competência: {month:02d}/{year}\n")

# Snapshot antes
def audit(label):
    print(f"=== {label} ===")
    visual = build_visual_schedule_dataframe(year, month)
    summary = employee_monthly_summary(year, month)
    pao = summary[summary["cargo"].isin(["PAO", "PAO FCF"])] if not summary.empty else pd.DataFrame()
    for _, r in pao.iterrows():
        name = r["funcionario"]
        row = visual[visual["Funcionário"] == name]
        if row.empty:
            continue
        row = row.iloc[0]
        cols = [c for c in visual.columns if is_visual_day_column(c)][1:]
        blanks = [c for c in cols if not str(row.get(c, "")).strip()]
        print(
            f"  {name}: turnos={r['turnos_trabalhados']} folgas={r['total_folgas']} "
            f"social={r.get('folga_social',0)} voo={r.get('voo',0)} blanks={len(blanks)}"
        )
        if blanks:
            print(f"    dias vazios: {blanks[:15]}{'...' if len(blanks)>15 else ''}")
    print()

audit("ANTES (estado atual)")

print("Reexecutando auto_allocate_rests...")
auto_allocate_rests(year, month, ["PAO", "PAO FCF"])
audit("DEPOIS auto_allocate_rests")

# Por funcionário PAO: por que densify falha?
from core.scheduler import _densify_shifts_for_employee, _count_shift_days, can_work
from database.repositories import build_shift_restriction_map
from core.rules import build_shift_time_map
from core.scheduler import shifts_df

shift_map = build_shift_time_map()
shift_restrictions = build_shift_restriction_map(year, month)

for _, emp in employees_df("PAO").iterrows():
    emp_id = int(emp["id"])
    sched = schedule_df(start, end)
    alloc = allocations_df(start, end)
    planned = {}
    if not sched.empty:
        for _, r in sched.iterrows():
            if int(r["funcionario_id"]) == emp_id:
                planned[(emp_id, pd.to_datetime(r["data"]).date())] = r["turno"]
    blocked = {}
    if not alloc.empty:
        for _, r in alloc.iterrows():
            if int(r["funcionario_id"]) == emp_id:
                blocked[(emp_id, pd.to_datetime(r["data"]).date())] = r["tipo"]

    free = [d for d in days if (emp_id, d) not in blocked and not planned.get((emp_id, d))]
    sh_codes = [s["codigo"] for s in shifts_df("PAO").to_dict("records") if s["codigo"] != "T8"] if not shifts_df("PAO").empty else ["T6","T7","T8"]
    fail_reasons = {}
    for d in free[:8]:
        for sh in sh_codes:
            ok, reason = can_work(emp, d, sh, blocked, planned, shift_map=shift_map, shift_restrictions=shift_restrictions, strict=False)
            if not ok:
                fail_reasons.setdefault(str(d), []).append(f"{sh}:{reason}")
    if free:
        print(f"{emp['nome']}: {len(free)} dias livres, turnos={_count_shift_days(emp_id, planned, days)}, amostra falhas:")
        for d, rs in list(fail_reasons.items())[:3]:
            print(f"  {d}: {rs[0]}")
