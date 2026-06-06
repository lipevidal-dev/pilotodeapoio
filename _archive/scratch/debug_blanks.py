import shutil, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from database.connection import set_db_path
REAL = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
TEMP = ROOT / "_archive" / "scratch" / "escala_audit_temp.db"
shutil.copy2(REAL, TEMP)
set_db_path(TEMP)
from core.scheduler_v2 import generate_unified_schedule
from core.scheduler import count_visual_blank_cells
from services.schedule_service import ScheduleService
from services.exporter_pdf import build_visual_schedule_dataframe
from database.repositories import employees_df, allocations_df
from core.rules import month_range
from core.spreadsheet_validator import employee_rest_count

Y, M = 2026, 6
generate_unified_schedule(Y, M, ["PAO", "APAO", "PAO FCF"], clear_existing=True, max_attempts=8)
print("blanks", count_visual_blank_cells(Y, M))
start, end = month_range(Y, M)
for role in ["PAO", "PAO FCF"]:
    for _, e in employees_df(role).iterrows():
        eid = int(e["id"])
        rc = employee_rest_count(Y, M, eid)
        print(f"  {e['nome'][:25]:25} folgas={rc}")
changes = ScheduleService.fill_blank_cells_with_flights(Y, M)
print("fill changes", len(changes))
print("blanks after", count_visual_blank_cells(Y, M))
