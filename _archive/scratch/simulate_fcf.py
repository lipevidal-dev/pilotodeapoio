import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

import sqlite3
import pandas as pd
from database.connection import set_db_path
from core.scheduler import generate_auto_schedule

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

# Let's run a dry-run/simulation of generate_auto_schedule for June 2026
roles = ["PAO FCF"]
print("Running auto schedule for PAO FCF...")
log_df = generate_auto_schedule(2026, 6, roles, clear_existing=True)

# Now, let's query the assignments for FCF
conn = sqlite3.connect(db_path)
df_assign = pd.read_sql_query("SELECT a.work_date, e.name, a.shift_code FROM assignments a JOIN employees e ON a.employee_id = e.id WHERE e.role = 'PAO FCF' ORDER BY a.work_date", conn)
print("\n--- ASSIGNMENTS GENERATED ---")
print(df_assign.to_string())

# Count per employee
print("\n--- COUNT PER EMPLOYEE ---")
print(df_assign["name"].value_counts())

# Close and clear assignments to restore state
conn.execute("DELETE FROM assignments WHERE employee_id IN (SELECT id FROM employees WHERE role = 'PAO FCF')")
conn.commit()
conn.close()
