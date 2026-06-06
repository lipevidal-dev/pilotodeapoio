import sys
from pathlib import Path
sys.path.append(str(Path("c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4")))

import sqlite3
import pandas as pd
from datetime import date, timedelta
from database.connection import set_db_path, execute
from database.repositories import employees_df, allocations_df, schedule_df, add_allocation, heal_pao_social_rules
from core.rules import month_range, iter_days, monthly_rest_count

db_path = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
set_db_path(db_path)

def dev_allocate_rests_and_flights(year, month, roles_to_generate):
    start_date, end_date = month_range(year, month)
    target_roles = [r for r in roles_to_generate if r in ["PAO", "PAO FCF"]]
    if not target_roles:
        return pd.DataFrame()

    placeholders = ",".join(["?"] * len(target_roles))
    params = [str(start_date), str(end_date)] + target_roles

    # 1. Clear existing automatic rests and flights
    execute(f"""
        DELETE FROM allocations
        WHERE alloc_date BETWEEN ? AND ?
        AND (notes LIKE 'Gerado automaticamente%' OR notes LIKE 'Preenchimento rápido%')
        AND alloc_type IN ('FOLGA', 'FOLGA SOCIAL', 'VOO')
        AND employee_id IN (
            SELECT id FROM employees WHERE role IN ({placeholders})
        )
    """, tuple(params))

    # Load updated state
    all_existing = schedule_df(start_date, end_date)
    planned = {}
    if not all_existing.empty:
        for _, r in all_existing.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    alloc = allocations_df(start_date, end_date)
    blocked = {}
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    created = []
    days_in_month = list(iter_days(year, month))

    for role in target_roles:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue

        for _, emp in emp_df.iterrows():
            emp_id = int(emp["id"])
            emp_nome = emp["nome"]

            # Skip employees who are fully on vacation
            emp_allocs = allocations_df(start_date, end_date)
            if not emp_allocs.empty:
                emp_allocs = emp_allocs[emp_allocs["funcionario_id"] == emp_id]
                vacation_days = len(emp_allocs[emp_allocs["tipo"] == "FÉRIAS"])
                if vacation_days >= 28:
                    print(f"Skipping {emp_nome} as they are on vacation for {vacation_days} days.")
                    continue

            # Helper functions to get current status
            def get_status():
                rest_set = {
                    d for d in days_in_month
                    if blocked.get((emp_id, d)) in ["FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO", "FÉRIAS"]
                }
                free_days = [
                    d for d in days_in_month
                    if (emp_id, d) not in blocked and not planned.get((emp_id, d))
                ]
                return rest_set, free_days

            rest_set, free_days = get_status()
            current_rests = len(rest_set)
            needed = max(0, 10 - current_rests)

            print(f"\nEmployee: {emp_nome} ({role}) | Rests: {current_rests} | Needed: {needed}")

            # Step 1: Ensure EXACTLY 1 Weekend Pair (FOLGA SOCIAL)
            # Find weekends in the month
            weekends = []
            for d in days_in_month:
                if d.weekday() == 5: # Saturday
                    d2 = d + timedelta(days=1)
                    if d2 <= end_date:
                        weekends.append((d, d2))

            # Check if they already have a weekend fully blocked as rest
            already_has_social = False
            for sat, sun in weekends:
                if sat in rest_set and sun in rest_set:
                    already_has_social = True
                    break

            social_weekend = None
            if not already_has_social and needed >= 2:
                # Find an eligible weekend where both Saturday and Sunday are free
                for sat, sun in weekends:
                    if sat in free_days and sun in free_days:
                        social_weekend = (sat, sun)
                        break

                if social_weekend:
                    sat, sun = social_weekend
                    add_allocation(emp_id, sat, "FOLGA", "Gerado automaticamente por meta de folgas")
                    add_allocation(emp_id, sun, "FOLGA", "Gerado automaticamente por meta de folgas")
                    blocked[(emp_id, sat)] = "FOLGA"
                    blocked[(emp_id, sun)] = "FOLGA"
                    created.append({"funcionario": emp_nome, "data": str(sat), "tipo": "FOLGA (Social)"})
                    created.append({"funcionario": emp_nome, "data": str(sun), "tipo": "FOLGA (Social)"})
                    needed -= 2
                    rest_set, free_days = get_status()
                    print(f"  Allocated FOLGA SOCIAL on weekend {sat} & {sun}")

            # Step 2: Group 3 Off-days Together (tente agrupar 3 folgas juntas)
            # If we just allocated a social weekend, let's try to add Friday or Monday to make it a 3-day block
            if social_weekend and needed >= 1:
                sat, sun = social_weekend
                friday = sat - timedelta(days=1)
                monday = sun + timedelta(days=1)
                
                third_day = None
                if friday in free_days and friday >= start_date:
                    third_day = friday
                elif monday in free_days and monday <= end_date:
                    third_day = monday
                
                if third_day:
                    add_allocation(emp_id, third_day, "FOLGA", "Gerado automaticamente por meta de folgas")
                    blocked[(emp_id, third_day)] = "FOLGA"
                    created.append({"funcionario": emp_nome, "data": str(third_day), "tipo": "FOLGA (Agrupada 3 dias)"})
                    needed -= 1
                    rest_set, free_days = get_status()
                    print(f"  Expanded social weekend to 3-day block by adding {third_day}")

            # If they already had a social weekend or we couldn't expand, check if they have any block of 3 off-days
            # If not, let's try to create a block of 3 consecutive off-days from free days
            rest_set, free_days = get_status()
            has_3_block = False
            rest_list = sorted(list(rest_set))
            for i in range(len(rest_list) - 2):
                if rest_list[i+1] == rest_list[i] + timedelta(days=1) and rest_list[i+2] == rest_list[i] + timedelta(days=2):
                    has_3_block = True
                    break
            
            if not has_3_block and needed >= 3:
                # Find a block of 3 consecutive free days
                three_block = None
                for i in range(len(free_days) - 2):
                    d1 = free_days[i]
                    d2 = free_days[i+1]
                    d3 = free_days[i+2]
                    if d2 == d1 + timedelta(days=1) and d3 == d1 + timedelta(days=2):
                        three_block = (d1, d2, d3)
                        break
                
                if three_block:
                    for d in three_block:
                        add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                        blocked[(emp_id, d)] = "FOLGA"
                        created.append({"funcionario": emp_nome, "data": str(d), "tipo": "FOLGA (Bloco 3)"})
                    needed -= 3
                    rest_set, free_days = get_status()
                    print(f"  Created a new 3-day off block: {three_block}")

            # Step 3: Allocate remaining off-days in pairs
            rest_set, free_days = get_status()
            while needed >= 2:
                # Find a pair of consecutive free days
                pair = None
                for i in range(len(free_days) - 1):
                    d1 = free_days[i]
                    d2 = free_days[i+1]
                    if d2 == d1 + timedelta(days=1):
                        pair = (d1, d2)
                        break
                
                if pair:
                    d1, d2 = pair
                    add_allocation(emp_id, d1, "FOLGA", "Gerado automaticamente por meta de folgas")
                    add_allocation(emp_id, d2, "FOLGA", "Gerado automaticamente por meta de folgas")
                    blocked[(emp_id, d1)] = "FOLGA"
                    blocked[(emp_id, d2)] = "FOLGA"
                    created.append({"funcionario": emp_nome, "data": str(d1), "tipo": "FOLGA (Par)"})
                    created.append({"funcionario": emp_nome, "data": str(d2), "tipo": "FOLGA (Par)"})
                    needed -= 2
                    rest_set, free_days = get_status()
                    print(f"  Allocated weekday pair: {pair}")
                else:
                    break

            # Step 4: Allocate single rest if needed is 1
            rest_set, free_days = get_status()
            if needed == 1:
                # Try to place it adjacent to an existing rest to avoid monofolga
                placed = False
                for d in free_days:
                    if (d - timedelta(days=1) in rest_set) or (d + timedelta(days=1) in rest_set):
                        add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                        blocked[(emp_id, d)] = "FOLGA"
                        created.append({"funcionario": emp_nome, "data": str(d), "tipo": "FOLGA (Adjacente)"})
                        needed -= 1
                        rest_set, free_days = get_status()
                        placed = True
                        print(f"  Allocated single rest adjacent: {d}")
                        break
                
                # If we couldn't place adjacent, we must force a pair (making 11 rests total) to avoid monofolga
                if not placed:
                    for i in range(len(free_days) - 1):
                        d1 = free_days[i]
                        d2 = free_days[i+1]
                        if d2 == d1 + timedelta(days=1):
                            add_allocation(emp_id, d1, "FOLGA", "Gerado automaticamente por meta de folgas")
                            add_allocation(emp_id, d2, "FOLGA", "Gerado automaticamente por meta de folgas")
                            blocked[(emp_id, d1)] = "FOLGA"
                            blocked[(emp_id, d2)] = "FOLGA"
                            created.append({"funcionario": emp_nome, "data": str(d1), "tipo": "FOLGA (Par 11º Dia)"})
                            created.append({"funcionario": emp_nome, "data": str(d2), "tipo": "FOLGA (Par 11º Dia)"})
                            needed = 0
                            rest_set, free_days = get_status()
                            print(f"  Forced weekday pair to avoid monofolga (total 11 rests): {d1} & {d2}")
                            break

            # Fallback for remaining needed (should be 0)
            rest_set, free_days = get_status()
            if needed > 0:
                for d in free_days:
                    if needed <= 0:
                        break
                    add_allocation(emp_id, d, "FOLGA", "Gerado automaticamente por meta de folgas")
                    blocked[(emp_id, d)] = "FOLGA"
                    created.append({"funcionario": emp_nome, "data": str(d), "tipo": "FOLGA (Fallback)"})
                    needed -= 1
                    rest_set, free_days = get_status()
                    print(f"  Allocated fallback single rest: {d}")

            # Step 5: Group Rests with Flights (preferencia para alocar as folgas agrupadas com os voos, para que eu possa ter um agrupamento de 5-6 dias juntos)
            # Find contiguous blocks of rests and place flights (VOO) immediately before and after them
            rest_set, free_days = get_status()
            
            # Find off-day blocks
            rest_list = sorted(list(rest_set))
            blocks = []
            curr_block = []
            for d in rest_list:
                if not curr_block:
                    curr_block = [d]
                else:
                    if d == curr_block[-1] + timedelta(days=1):
                        curr_block.append(d)
                    else:
                        blocks.append(curr_block)
                        curr_block = [d]
            if curr_block:
                blocks.append(curr_block)

            print(f"  Rests blocks found: {[[str(x) for x in b] for b in blocks]}")

            # Try to expand these blocks to 5-6 days using flights (VOO)
            for block in blocks:
                # We want the block of flights + rests to be 5 to 6 days
                block_len = len(block)
                needed_flights = max(0, 5 - block_len) # target at least 5 days total
                
                # Check days before and after the block
                day_before = block[0] - timedelta(days=1)
                day_after = block[-1] + timedelta(days=1)
                
                # We can place flights on day_before, day_after, day_before-1, day_after+1, etc.
                expansion_days = [day_before, day_after, day_before - timedelta(days=1), day_after + timedelta(days=1)]
                
                flights_added = 0
                for d in expansion_days:
                    if flights_added >= needed_flights:
                        break
                    if d >= start_date and d <= end_date and d in free_days:
                        add_allocation(emp_id, d, "VOO", "Gerado automaticamente para parear com folgas")
                        blocked[(emp_id, d)] = "VOO"
                        created.append({"funcionario": emp_nome, "data": str(d), "tipo": "VOO (Agrupamento)"})
                        free_days.remove(d)
                        flights_added += 1
                        print(f"    Added VOO on {d} to group with rest block")

            # Step 6: Fill ALL remaining free days with flights (VOO) - "não pode ficar dias em branco"
            rest_set, free_days = get_status()
            for d in list(free_days):
                add_allocation(emp_id, d, "VOO", "Preenchimento rápido de células vazias")
                blocked[(emp_id, d)] = "VOO"
                created.append({"funcionario": emp_nome, "data": str(d), "tipo": "VOO (Preenchimento)"})
                print(f"    Filled blank day {d} with VOO")

            # Run healing for social rules to promote the weekend pair to FOLGA SOCIAL
            heal_pao_social_rules(emp_id, (year, month))

    return pd.DataFrame(created)

# Test run for June 2026
print("Running dev_allocate_rests_and_flights...")
df_log = dev_allocate_rests_and_flights(2026, 6, ["PAO", "PAO FCF"])

# Let's inspect final allocations in the database for June 2026
conn = sqlite3.connect(db_path)
df_final = pd.read_sql_query("""
    SELECT e.name, e.role, al.alloc_date, al.alloc_type, al.notes
    FROM allocations al
    JOIN employees e ON al.employee_id = e.id
    WHERE al.alloc_date BETWEEN '2026-06-01' AND '2026-06-30'
    ORDER BY e.role, e.name, al.alloc_date
""", conn)
print("\n=== FINAL ALLOCATIONS FOR JUNE 2026 ===")
print(df_final)

# Count of off-days and flights per employee
print("\n=== TOTALS PER PILOT IN JUNE 2026 ===")
for name in df_final["name"].unique():
    emp_df = df_final[df_final["name"] == name]
    rests = len(emp_df[emp_df["alloc_type"].str.contains("FOLGA") | emp_df["alloc_type"].str.contains("FÉRIAS")])
    flights = len(emp_df[emp_df["alloc_type"] == "VOO"])
    print(f"Pilot: {name} | Off-days: {rests} | Flights: {flights}")

conn.close()
