import sqlite3
import shutil
import pandas as pd
from pathlib import Path
import sys
import os

# Add project path to sys.path
sys.path.append("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")

from database.connection import set_db_path
from database.repositories import delete_month_schedule, allocations_df
from services.schedule_service import ScheduleService

# Path to real db and temp db
db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
temp_db_path = Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4/scratch/escala_temp_flow.db")

print("Copying database to temp...")
shutil.copy2(db_path, temp_db_path)
set_db_path(temp_db_path)

conn = sqlite3.connect(temp_db_path)

def print_allocations(label):
    print(f"\n=== ALLOCATIONS: {label} ===")
    df = pd.read_sql_query("""
        SELECT al.id, e.name, e.role, al.alloc_date, al.alloc_type, al.notes 
        FROM allocations al 
        JOIN employees e ON al.employee_id = e.id 
        WHERE al.alloc_date BETWEEN '2026-06-01' AND '2026-06-30'
        AND (e.role = 'PAO FCF' OR e.name = 'ALEXANDRE ESPOSITO')
        ORDER BY e.name, al.alloc_date
    """, conn)
    print(df.to_string())

# Step 0: Initial
print_allocations("INITIAL STATE (June 2026)")

# Step 1: Generate Auto Schedule
print("\nRunning generate_auto_schedule...")
roles = ["PAO", "APAO", "PAO FCF"]
ScheduleService.generate_auto_schedule(2026, 6, roles)
print_allocations("AFTER GENERATE AUTO SCHEDULE")

# Step 2: Allocate Rests
print("\nRunning allocate_rests...")
ScheduleService.allocate_rests(2026, 6, roles)
print_allocations("AFTER ALLOCATE RESTS")

# Step 3: Clear Schedule
print("\nRunning delete_month_schedule...")
delete_month_schedule(2026, 6)
print_allocations("AFTER CLEAR SCHEDULE")

conn.close()

# Clean up temp db file
if temp_db_path.exists():
    os.remove(temp_db_path)
