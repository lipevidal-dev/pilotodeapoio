import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

import sqlite3
import pandas as pd
from database.connection import set_db_path
from core.scheduler import generate_auto_schedule

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

# Let's run a dry-run/simulation of generate_auto_schedule for June 2026 for all roles
roles = ["PAO", "APAO", "PAO FCF"]
print("Running auto schedule for all roles...")
log_df = generate_auto_schedule(2026, 6, roles, clear_existing=True)

# Now, let's query the assignments for FCF
conn = sqlite3.connect(db_path)
df_assign = pd.read_sql_query("SELECT a.work_date, e.name, e.role, a.shift_code FROM assignments a JOIN employees e ON a.employee_id = e.id ORDER BY e.role, e.name, a.work_date", conn)

# Count per employee for each role
for r in roles:
    print(f"\n--- COUNT PER EMPLOYEE FOR {r} ---")
    df_role = df_assign[df_assign["role"] == r]
    print(df_role["name"].value_counts())

# Close and clear assignments to restore state
conn.execute("DELETE FROM assignments")
conn.commit()
conn.close()
