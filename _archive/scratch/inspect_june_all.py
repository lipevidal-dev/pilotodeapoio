import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

import sqlite3
import pandas as pd
from database.connection import set_db_path

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

conn = sqlite3.connect(db_path)

print("=== ACTIVE EMPLOYEES ===")
df_emp = pd.read_sql_query("SELECT id, name, role, fixed_shift_code, is_fixed_shift, active FROM employees WHERE active = 1 ORDER BY role, seniority", conn)
print(df_emp.to_string())

print("\n=== ALL ALLOCATIONS FOR JUNE 2026 ===")
df_alloc = pd.read_sql_query("""
    SELECT a.id, e.name, e.role, a.alloc_date, a.alloc_type, a.notes 
    FROM allocations a 
    JOIN employees e ON a.employee_id = e.id 
    WHERE a.alloc_date BETWEEN '2026-06-01' AND '2026-06-30' 
    ORDER BY e.role, e.name, a.alloc_date
""", conn)
print(df_alloc.to_string())

print("\n=== ALL ASSIGNMENTS FOR JUNE 2026 ===")
df_assign = pd.read_sql_query("""
    SELECT a.id, e.name, e.role, a.work_date, a.shift_code, a.notes 
    FROM assignments a 
    JOIN employees e ON a.employee_id = e.id 
    WHERE a.work_date BETWEEN '2026-06-01' AND '2026-06-30' 
    ORDER BY e.role, e.name, a.work_date
""", conn)
print(df_assign.to_string())

conn.close()
