"""Relatório de furos estilo planilha."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from core.spreadsheet_validator import (
    list_spreadsheet_gaps,
    coverage_health,
    daily_summary_row,
    daily_pao_coverage_matrix,
    employee_rest_count,
)
from database.repositories import schedule_df, allocations_df, employees_df
from core.rules import month_range

year, month = 2026, 6
start, end = month_range(year, month)

print("=" * 60)
print(f"RELATÓRIO DE FUROS — {month:02d}/{year}")
print("=" * 60)

health = coverage_health(year, month)
print("\n## COBERTURA DE TURNOS (regra inviolável: T6+T7+T8 = 1 PAO/dia cada)")
print(health["message"])
print(f"  PAO furos: {health['pao_gaps']} | APAO furos: {health['apao_gaps']} | Total: {health['total_gaps']}")

gaps = list_spreadsheet_gaps(year, month)
if gaps.empty:
    print("\n  Nenhum furo de turno detectado.")
else:
    print("\n  Lista de furos:")
    for _, r in gaps.iterrows():
        falta = int(r["precisa"]) - int(r["tem"])
        print(
            f"  - {r['data']} | {r['tipo_linha']} | {r['turno']} | "
            f"tem={r['tem']} precisa={r['precisa']} (faltam {falta})"
        )

pao = daily_pao_coverage_matrix(year, month)
if not pao.empty:
    print("\n## RESUMO PAO POR TURNO")
    for sh in ["T6", "T7", "T8"]:
        sub = pao[pao["turno"] == sh]
        ok = len(sub[sub["status"] == "OK"])
        furo = len(sub[sub["status"] == "FURO"])
        print(f"  {sh}: {ok} dias OK, {furo} furos")

print("\n## FOLGAS (regra inviolável: exatamente 10/mês por piloto PAO e PAO FCF)")
emps = employees_df()
for cargo in ["PAO", "PAO FCF"]:
    sub = emps[emps["cargo"].astype(str).str.upper() == cargo.upper()]
    viol = []
    for _, e in sub.iterrows():
        rc = employee_rest_count(year, month, int(e["id"]))
        if rc != 10:
            viol.append((e["nome"], rc))
    print(f"  {cargo}: {len(sub)} pilotos, {len(viol)} fora da meta")
    for nome, rc in sorted(viol, key=lambda x: abs(x[1] - 10), reverse=True)[:20]:
        diff = rc - 10
        sinal = "+" if diff > 0 else ""
        print(f"    - {nome}: {rc} folgas ({sinal}{diff})")
    if len(viol) > 20:
        print(f"    ... e mais {len(viol) - 20}")

sched = schedule_df(start, end)
alloc = allocations_df(start, end)
print("\n## DADOS NO BANCO")
print(f"  Escalas (assignments): {len(sched)} registros")
print(f"  Pré-alocações: {len(alloc)} registros")

summary = daily_summary_row(year, month)
if not summary.empty:
    bad_days = summary[(summary["pao_t6"] < 1) | (summary["pao_t7"] < 1) | (summary["pao_t8"] < 1)]
    print(f"\n## DIAS COM ALGUM TURNO PAO VAZIO (visão planilha): {len(bad_days)}")
    for _, r in bad_days.iterrows():
        parts = []
        if r["pao_t6"] < 1:
            parts.append("T6=0")
        if r["pao_t7"] < 1:
            parts.append("T7=0")
        if r["pao_t8"] < 1:
            parts.append("T8=0")
        print(f"  Dia {int(r['dia']):02d}: {', '.join(parts)}")
