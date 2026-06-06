import sqlite3
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from services.schedule_service import ScheduleService
from core.scheduler_v2 import generate_unified_schedule

db = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM assignments WHERE work_date BETWEEN '2026-06-01' AND '2026-06-30'")
print("assignments june BEFORE regen:", cur.fetchone()[0])
conn.close()

roles = ["PAO", "APAO", "PAO FCF"]
log = generate_unified_schedule(2026, 6, roles, clear_existing=True)
gaps = ScheduleService.crosscheck_operational_gaps(2026, 6)
print("gaps after:", len(gaps))

conn = sqlite3.connect(db)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM assignments WHERE work_date BETWEEN '2026-06-01' AND '2026-06-30'")
print("assignments june AFTER regen:", cur.fetchone()[0])
conn.close()
