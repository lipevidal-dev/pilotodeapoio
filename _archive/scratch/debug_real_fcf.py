import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

import sqlite3
import pandas as pd
from database.connection import set_db_path

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

conn = sqlite3.connect(db_path)

print("--- PAO FCF EMPLOYEES ---")
df_fcf = pd.read_sql_query("SELECT id, name, role, fixed_shift_code, is_fixed_shift FROM employees WHERE role = 'PAO FCF'", conn)
print(df_fcf)

fcf_ids = df_fcf["id"].tolist()
if fcf_ids:
    placeholders = ",".join(["?"] * len(fcf_ids))
    print("\n--- PAO FCF ALLOCATIONS FOR JUNE 2026 ---")
    df_alloc = pd.read_sql_query(f"SELECT a.id, e.name, a.alloc_date, a.alloc_type, a.notes FROM allocations a JOIN employees e ON a.employee_id = e.id WHERE a.employee_id IN ({placeholders}) AND a.alloc_date BETWEEN '2026-06-01' AND '2026-06-30'", conn, params=tuple(fcf_ids))
    print(df_alloc)

    print("\n--- PAO FCF ASSIGNMENTS FOR JUNE 2026 ---")
    df_assign = pd.read_sql_query(f"SELECT a.id, e.name, a.work_date, a.shift_code, a.notes FROM assignments a JOIN employees e ON a.employee_id = e.id WHERE a.employee_id IN ({placeholders}) AND a.work_date BETWEEN '2026-06-01' AND '2026-06-30' ORDER BY a.work_date", conn, params=tuple(fcf_ids))
    print(df_assign.to_string())

conn.close()
