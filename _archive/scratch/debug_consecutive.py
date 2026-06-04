import os
import sys
from pathlib import Path
from datetime import date

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from database.connection import set_db_path, init_db
from database.repositories import add_employee, employees_df, allocations_df, schedule_df
from core.scheduler import generate_auto_schedule
from core.rules import validate_rules

def main():
    db_file = Path("tests/test_escala_debug.db")
    if db_file.exists():
        try:
            db_file.unlink()
        except:
            pass

    set_db_path(str(db_file.resolve()))
    init_db()

    # Populate employees
    add_employee("PAO SILVA", "PAO", seniority=1, fixed_shift_code=None, is_fixed_shift=0, notes="Mock PAO 1")
    add_employee("PAO SANTOS", "PAO", seniority=2, fixed_shift_code=None, is_fixed_shift=0, notes="Mock PAO 2")
    add_employee("PAO OLIVEIRA", "PAO", seniority=3, fixed_shift_code=None, is_fixed_shift=0, notes="Mock PAO 3")
    add_employee("APAO LIMA", "APAO", seniority=1, fixed_shift_code=None, is_fixed_shift=0, notes="Mock APAO 1")
    add_employee("APAO COSTA", "APAO", seniority=2, fixed_shift_code=None, is_fixed_shift=0, notes="Mock APAO 2")

    print("Generating schedule...")
    log_df = generate_auto_schedule(2026, 6, ["PAO", "APAO"])

    print("\n--- ALLOCATIONS ---")
    allocs = allocations_df(date(2026, 6, 1), date(2026, 6, 30))
    print(allocs[["data", "funcionario", "tipo", "observacao"]].to_string())

    print("\n--- VALIDATION ISSUES ---")
    issues = validate_rules(2026, 6)
    print(issues[["gravidade", "tipo", "data", "funcionario", "detalhe"]].to_string())

if __name__ == "__main__":
    main()
