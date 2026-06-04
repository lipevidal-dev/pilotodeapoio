import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.rules import (
    employee_vacation_dates, is_employee_planning_active_month,
    employee_plannable_days, validate_rules, is_employee_on_vacation_fortnight,
)
from database.repositories import employees_df
from core.scheduler import count_visual_blank_cells

y, m = 2026, 6
print("=== FERIAS / PLANEJAMENTO ===")
for role in ["PAO", "PAO FCF"]:
    for _, e in employees_df(role).iterrows():
        eid = int(e["id"])
        vac = len(employee_vacation_dates(eid, y, m))
        plan = len(employee_plannable_days(eid, y, m))
        active = is_employee_planning_active_month(eid, y, m)
        q1 = is_employee_on_vacation_fortnight(eid, y, m, 1)
        q2 = is_employee_on_vacation_fortnight(eid, y, m, 2)
        if vac or not active:
            print(f"  {e['nome']} ({role}): ferias={vac} plan={plan} ativo={active} Q1={q1} Q2={q2}")

df = validate_rules(y, m)
for tipo in ["FOLGAS PAO", "FALTA GRUPO T8/T8/ND", "META PAO FCF - FOLGAS"]:
    if df.empty:
        continue
    sub = df[df["tipo"] == tipo]
    names_on_vacation = []
    for _, e in employees_df().iterrows():
        if not is_employee_planning_active_month(int(e["id"]), y, m):
            names_on_vacation.append(e["nome"])
    viol = sub[sub["funcionario"].isin(names_on_vacation)]
    if not viol.empty:
        print(f"\nERRO: {tipo} ainda aponta quem está de férias:")
        print(viol[["funcionario", "detalhe"]].to_string())

print("\nBlanks (exceto ferias):", count_visual_blank_cells(y, m))
