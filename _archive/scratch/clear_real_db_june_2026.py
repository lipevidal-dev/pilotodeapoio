import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

from database.connection import set_db_path
from database.repositories import delete_month_schedule

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

print("Clearing the actual database for June 2026...")
delete_month_schedule(2026, 6)
print("Clearing complete. June 2026 is back to its pristine manual allocations state.")
