"""Gera jun/2026 e compara piloto a piloto (estilo planilha)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from datetime import date
import pandas as pd

from database.connection import set_db_path, DEFAULT_DB_PATH, backup_db
from database.repositories import employees_df, schedule_df, allocations_df
from core.scheduler import generate_auto_schedule, auto_allocate_rests, get_fortnight_group
from services.exporter_pdf import build_visual_schedule_dataframe
from services.schedule_service import ScheduleService

set_db_path(DEFAULT_DB_PATH)

YEAR, MONTH = 2026, 6
ROLES = ["PAO", "APAO", "PAO FCF"]
TARGETS = ["Helio", "Hélio", "Davi", "Gustavo", "André", "Andre", "Vinícius", "Vinicius"]

def match_target(name: str) -> bool:
    n = name.lower()
    return any(t.lower() in n for t in TARGETS)


def row_visual(emp_name, visual_df):
    sub = visual_df[visual_df["Funcionário"].str.contains(emp_name.split()[0], case=False, na=False)]
    if sub.empty:
        return None
    cols = [c for c in visual_df.columns if str(c).strip().isdigit()]
    cols = sorted(cols, key=lambda x: int(str(x).strip()))
    row = sub.iloc[0]
    return {int(str(c).strip()): str(row[c] or "").strip() for c in cols}


def summarize_pattern(cells: dict, grp: str | None):
    if not cells:
        return {}
    shift_win = set(range(1, 16)) if grp == "A" else set(range(16, 31))
    voo_win = set(range(16, 31)) if grp == "A" else set(range(1, 16))
    shifts = [d for d, v in cells.items() if v.startswith("T")]
    rests = [d for d, v in cells.items() if v in ("F", "FP", "FS", "FAG", "FA")]
    voos = [d for d, v in cells.items() if v == "V"]
    blocks = [d for d, v in cells.items() if v in ("L", "FER", "K", "C")]
    return {
        "turnos_total": len(shifts),
        "turnos_q_turno": len([d for d in shifts if d in shift_win]),
        "turnos_q_voo": len([d for d in shifts if d in voo_win]),
        "folgas": len(rests),
        "voos": len(voos),
        "voos_q_voo": len([d for d in voos if d in voo_win]),
        "bloqueios_LK": sorted(blocks),
        "dias_voo": sorted(voos),
        "dias_turno": sorted(shifts),
    }


def print_line(label, cells):
    if not cells:
        print(f"  {label}: (não encontrado)")
        return
    days = sorted(cells.keys())
    s = " ".join(f"{d:2d}:{cells[d] or '.'}" for d in days)
    print(f"  {label}: {s}")


print("=" * 70)
print(f"DB: {DEFAULT_DB_PATH}")
backup_db("antes_comparacao_planilha_jun2026")

print("\n--- PRÉ-ALOCAÇÕES EXISTENTES (jun/2026) ---")
alloc = allocations_df(date(YEAR, MONTH, 1), date(YEAR, MONTH, 30))
if alloc.empty:
    print("  (nenhuma)")
else:
    for nome in sorted(alloc["funcionario"].unique()):
        if not match_target(nome):
            continue
        sub = alloc[alloc["funcionario"] == nome]
        for _, r in sub.iterrows():
            d = pd.to_datetime(r["data"]).day
            print(f"  {nome} dia {d:2d}: {r['tipo']}")

print("\n--- GERANDO ESCALA ---")
log_gen = generate_auto_schedule(YEAR, MONTH, ROLES, clear_existing=True)
print(f"  Log geração: {len(log_gen)} linhas")

print("\n--- ALOCANDO FOLGAS E VOO ---")
log_rest = auto_allocate_rests(YEAR, MONTH, ROLES)
print(f"  Log folgas/VOO: {len(log_rest)} linhas")

visual = build_visual_schedule_dataframe(YEAR, MONTH)
gaps = ScheduleService.crosscheck_operational_gaps(YEAR, MONTH)
quality = ScheduleService.employee_quality_report(YEAR, MONTH)

print("\n--- COBERTURA ---")
print(f"  Furos PAO: {len(gaps) if not gaps.empty else 0}")
if not gaps.empty:
    print(gaps[["data", "turno", "problema"]].head(15).to_string(index=False))

print("\n--- COMPARATIVO PILOTO A PILOTO ---")
emp_df = employees_df()
for _, emp in emp_df.iterrows():
    nome = emp["nome"]
    if emp["cargo"] not in ("PAO", "PAO FCF") or not match_target(nome):
        continue
    emp_id = int(emp["id"])
    grp = get_fortnight_group(emp_id, YEAR, MONTH)
    fixo = int(emp.get("fixo", 0) or 0)
    cells = row_visual(nome, visual)
    pat = summarize_pattern(cells, grp)
    print(f"\n{nome} | cargo={emp['cargo']} | grupo={grp or '-'} | fixo={fixo} | turno_fixo={emp.get('turno_fixo') or '-'}")
    print_line("Grade", cells)
    print(f"  Resumo: {pat}")
    if not quality.empty:
        q = quality[quality["funcionario"].str.contains(nome.split()[0], case=False, na=False)]
        if not q.empty:
            print(f"  Qualidade: nota={q.iloc[0]['nota']} | {q.iloc[0]['observacoes']}")

print("\n--- CHECKLIST ESTILO PLANILHA ---")
checks = []
for _, emp in emp_df.iterrows():
    nome = emp["nome"]
    if not match_target(nome):
        continue
    cells = row_visual(nome, visual) or {}
    emp_id = int(emp["id"])
    grp = get_fortnight_group(emp_id, YEAR, MONTH)

    if "vin" in nome.lower():
        l_days = [d for d, v in cells.items() if v in ("L", "FER")]
        ok = len(l_days) >= 28
        checks.append((nome, "Mês inteiro em L (férias)", ok, f"{len(l_days)} dias L"))

    if "hel" in nome.lower():
        k_days = [d for d, v in cells.items() if v in ("K", "C")]
        ok_k = 2 <= len(k_days) <= 5
        checks.append((nome, "Curso K nos dias 2-4", ok_k, f"dias K: {k_days}"))

    if grp == "A" and emp["cargo"] == "PAO" and not int(emp.get("fixo", 0) or 0):
        v2 = [d for d, v in cells.items() if v == "V" and d >= 16]
        t2 = [d for d, v in cells.items() if v.startswith("T") and d >= 16]
        checks.append((nome, "Grupo A: VOO predominante 16-30", len(v2) >= 8 and len(t2) <= 2, f"V={len(v2)} T={len(t2)}"))

    if int(emp.get("fixo", 0) or 0) == 1:
        streak = 0
        max_streak = 0
        for d in range(1, 31):
            v = cells.get(d, "")
            if v.startswith("T"):
                streak += 1
                max_streak = max(max_streak, streak)
            elif v in ("F", "FP", "FS", "FAG"):
                streak = 0
            else:
                streak = 0
        checks.append((nome, "Turno fixo: máx ~4 turnos seguidos", max_streak <= 5, f"max_streak={max_streak}"))

for nome, desc, ok, detail in checks:
    mark = "OK" if ok else "ATENÇÃO"
    print(f"  [{mark}] {nome}: {desc} ({detail})")

print("\nConcluído.")
