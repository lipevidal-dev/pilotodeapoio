"""Diagnóstico: por que T8 não fecha em jun/2026."""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from database.connection import set_db_path
from core.rules import month_range
from core.scheduler import (
    _reload_planned_blocked, build_shift_time_map, build_shift_restriction_map,
    _sort_by_seniority, can_work, _clear_clearable_allocation,
)
from core.t8_planner import try_close_t8_gap, day_needs_t8
from database.repositories import employees_df

REAL = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
TEMP = ROOT / "_archive" / "scratch" / "escala_audit_temp.db"
shutil.copy2(REAL, TEMP)
set_db_path(TEMP)

from core.scheduler_v2 import generate_unified_schedule

Y, M = 2026, 6
generate_unified_schedule(Y, M, ["PAO", "APAO", "PAO FCF"], clear_existing=True, max_attempts=5)

start, end = month_range(Y, M)
planned, blocked = _reload_planned_blocked(start, end)
shift_map = build_shift_time_map()
shift_restrictions = build_shift_restriction_map(Y, M)
log = []

gap_days = ["2026-06-09", "2026-06-10", "2026-06-20", "2026-06-29", "2026-06-30"]
from datetime import date
for ds in gap_days:
    d = date.fromisoformat(ds)
    print(f"\n=== {ds} needs_t8={day_needs_t8(planned, d)} ===")
    emps = _sort_by_seniority(employees_df("PAO").to_dict("records"))
    for emp in emps[:9]:
        eid = int(emp["id"])
        if planned.get((eid, d)):
            continue
        ok, reason = can_work(
            emp, d, "T8", blocked, planned,
            shift_map=shift_map, shift_restrictions=shift_restrictions,
            strict=False, coverage_emergency=True,
        )
        blk = blocked.get((eid, d), "")
        print(f"  {emp['nome'][:20]:20} ok={ok} reason={reason} blocked={blk}")

    ok = try_close_t8_gap(d, Y, M, planned, blocked, shift_map, shift_restrictions, None, start, end, log)
    print(f"  try_close -> {ok}, still needs={day_needs_t8(planned, d)}")
    if log:
        print(f"  log: {log[-1]}")
