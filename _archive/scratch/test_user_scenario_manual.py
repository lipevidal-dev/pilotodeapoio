import sqlite3
import shutil
import pandas as pd
from pathlib import Path
import sys
import os

# Add project path to sys.path
sys.path.append("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")

from database.connection import set_db_path
from database.repositories import delete_month_schedule, add_allocation, heal_pao_social_rules, allocations_df

# Path to real db and temp db
db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
temp_db_path = Path("scratch/escala_temp_user_manual.db")

print("Copying database to temp...")
shutil.copy2(db_path, temp_db_path)
set_db_path(temp_db_path)

# 1. Insert a manual FOLGA PEDIDA on a weekend day (e.g. 2026-06-06 is Saturday)
# and another one on 2026-06-07 (Sunday) for a PAO employee.
# Let's find a PAO employee ID first.
conn = sqlite3.connect(temp_db_path)
cursor = conn.cursor()
cursor.execute("SELECT id, name FROM employees WHERE role = 'PAO' LIMIT 1")
emp = cursor.fetchone()
if not emp:
    print("No PAO employee found!")
    sys.exit(1)

emp_id, emp_name = emp[0], emp[1]
print(f"Using PAO employee: {emp_name} (ID: {emp_id})")

# Clear existing allocations for this employee on those days first
cursor.execute("DELETE FROM allocations WHERE employee_id = ? AND alloc_date IN ('2026-06-06', '2026-06-07')", (emp_id,))
conn.commit()

# Insert manual allocations
print("Inserting manual FOLGA PEDIDA on 2026-06-06 and 2026-06-07...")
add_allocation(emp_id, "2026-06-06", "FOLGA PEDIDA", "Lançado manualmente")
add_allocation(emp_id, "2026-06-07", "FOLGA PEDIDA", "Lançado manualmente")

# Let's check allocations
def print_allocations():
    df = pd.read_sql_query("SELECT id, employee_id, alloc_date, alloc_type, notes FROM allocations WHERE employee_id = ? AND alloc_date IN ('2026-06-06', '2026-06-07')", conn)
    print(df.to_string())

print("\n--- After manual insert ---")
print_allocations()

# Run heal_pao_social_rules to promote them to FOLGA SOCIAL
print("\nRunning heal_pao_social_rules...")
heal_pao_social_rules(emp_id, "2026-06-06")

print("\n--- After promotion ---")
print_allocations()

# Run delete_month_schedule
print("\nRunning delete_month_schedule...")
delete_month_schedule(2026, 6)

print("\n--- After delete_month_schedule ---")
print_allocations()

conn.close()

# Clean up
if temp_db_path.exists():
    os.remove(temp_db_path)
