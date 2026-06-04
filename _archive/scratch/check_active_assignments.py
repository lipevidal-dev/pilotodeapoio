import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

import sqlite3
import pandas as pd
from database.connection import set_db_path

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

conn = sqlite3.connect(db_path)
df_assign = pd.read_sql_query("SELECT e.name, e.role, COUNT(a.id) as cnt FROM assignments a JOIN employees e ON a.employee_id = e.id WHERE a.work_date BETWEEN '2026-06-01' AND '2026-06-30' GROUP BY e.name, e.role ORDER BY e.role, cnt DESC", conn)
print("--- ASSIGNMENTS IN JUNE 2026 ---")
print(df_assign)
conn.close()
