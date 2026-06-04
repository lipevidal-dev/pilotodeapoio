import sqlite3
import shutil
import pandas as pd
from pathlib import Path
import sys
import os

# Add project path to sys.path
sys.path.append("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")

from database.connection import set_db_path
from database.repositories import delete_month_schedule, allocations_df, heal_pao_social_rules
from services.schedule_service import ScheduleService

# Path to real db and temp db
db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
temp_db_path = Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4/scratch/escala_temp_user.db")

print("Copying database to temp...")
shutil.copy2(db_path, temp_db_path)
set_db_path(temp_db_path)

conn = sqlite3.connect(temp_db_path)

def get_allocations_df():
    return pd.read_sql_query("""
        SELECT al.id, e.name, e.role, al.alloc_date, al.alloc_type, al.notes 
        FROM allocations al 
        JOIN employees e ON al.employee_id = e.id 
        WHERE al.alloc_date BETWEEN '2026-06-01' AND '2026-06-30'
        ORDER BY e.name, al.alloc_date
    """, conn)

# Initial manual allocations
df_initial = get_allocations_df()
print(f"Total manual allocations initially: {len(df_initial)}")

# Run generate_auto_schedule
print("\nRunning generate_auto_schedule...")
roles = ["PAO", "APAO", "PAO FCF"]
ScheduleService.generate_auto_schedule(2026, 6, roles)

df_after_gen = get_allocations_df()
print(f"Total allocations after generate: {len(df_after_gen)}")

# Run delete_month_schedule
print("\nRunning delete_month_schedule...")
delete_month_schedule(2026, 6)

df_after_clear = get_allocations_df()
print(f"Total allocations after clear: {len(df_after_clear)}")

# Compare initial vs after clear
deleted = df_initial[~df_initial["id"].isin(df_after_clear["id"])]
if not deleted.empty:
    print("\n!!! ERROR: SOME MANUAL ALLOCATIONS WERE DELETED !!!")
    print(deleted.to_string())
else:
    print("\nAll initial manual allocations were successfully preserved!")

conn.close()

# Clean up temp db file
if temp_db_path.exists():
    os.remove(temp_db_path)
