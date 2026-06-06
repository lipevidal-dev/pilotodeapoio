"""Relatório T8/T8/ND e dias em branco — jun/2026."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pandas as pd
from core.rules import month_range, iter_days, validate_rules
from services.exporter_pdf import build_visual_schedule_dataframe
from ui.components import is_visual_day_column
from database.repositories import schedule_df, allocations_df

year, month = 2026, 6
start, end = month_range(year, month)

print("=" * 60)
print(f"T8/T8/ND + DIAS EM BRANCO — {month:02d}/{year}")
print("=" * 60)

issues_df = validate_rules(year, month)
t8_types = {"T8 ISOLADO", "T8 SEM ND", "FALTA GRUPO T8/T8/ND"}
if issues_df.empty:
    t8_issues = []
else:
    t8_issues = issues_df[issues_df["tipo"].isin(t8_types)].to_dict("records")
print(f"\n## VIOLAÇÕES T8 ({len(t8_issues)})")
for i in t8_issues[:25]:
    print(f"  [{i.get('gravidade')}] {i.get('tipo')} | {i.get('funcionario')} | {i.get('data')} — {i.get('detalhe')}")
if len(t8_issues) > 25:
    print(f"  ... e mais {len(t8_issues) - 25}")

# Sequências T8 consecutivos > 2
sched = schedule_df(start, end)
if not sched.empty:
    print("\n## SEQUÊNCIAS T8 > 2 DIAS SEGUIDOS")
    for nome, grp in sched[sched["turno"] == "T8"].groupby("funcionario"):
        dates = sorted(pd.to_datetime(grp["data"]).dt.date.unique())
        streak = 1
        start_d = dates[0]
        for i in range(1, len(dates)):
            if (dates[i] - dates[i - 1]).days == 1:
                streak += 1
            else:
                if streak > 2:
                    print(f"  {nome}: {streak}x T8 seguidos a partir de {start_d}")
                streak = 1
                start_d = dates[i]
        if streak > 2:
            print(f"  {nome}: {streak}x T8 seguidos a partir de {start_d}")

visual = build_visual_schedule_dataframe(year, month)
print("\n## DIAS EM BRANCO NA GRADE VISUAL")
total_blanks = 0
for _, row in visual.iterrows():
    nome = row.get("Funcionário", row.get("funcionario", ""))
    cargo = row.get("Cargo", row.get("cargo", ""))
    cols = [c for c in visual.columns if is_visual_day_column(c)]
    blanks = [c for c in cols if not str(row.get(c, "")).strip()]
    if blanks:
        total_blanks += len(blanks)
        print(f"  {nome} ({cargo}): {len(blanks)} dia(s) vazio(s) — {blanks[:12]}{'...' if len(blanks) > 12 else ''}")
print(f"\n  Total células vazias: {total_blanks}")
