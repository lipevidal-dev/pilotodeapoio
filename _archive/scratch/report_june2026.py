import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from database.connection import set_db_path, DEFAULT_DB_PATH
from core.scheduler import get_fortnight_group
from services.exporter_pdf import build_visual_schedule_dataframe
from services.schedule_service import ScheduleService
from database.repositories import employees_df

set_db_path(DEFAULT_DB_PATH)
Y, M = 2026, 6
visual = build_visual_schedule_dataframe(Y, M)
gaps = ScheduleService.crosscheck_operational_gaps(Y, M)
emp = employees_df()
targets = ["ANDRE", "HELIO", "HELI", "DAVI", "GUSTAVO", "VINICIUS"]
cols = sorted([c for c in visual.columns if str(c).strip().isdigit()], key=lambda x: int(str(x).strip()))

for _, r in visual.iterrows():
    nome = r["Funcionário"]
    if r["Cargo"] not in ("PAO", "PAO FCF"):
        continue
    row = emp[emp["nome"] == nome]
    if row.empty:
        continue
    eid = int(row.iloc[0]["id"])
    if eid not in (50, 52, 53, 55, 56) and not any(t in nome.upper() for t in targets):
        continue
    grp = get_fortnight_group(eid, Y, M) if eid else None
    fixo = int(row.iloc[0].get("fixo", 0) or 0) if not row.empty else 0
    cells = {int(str(c).strip()): str(r[c] or "").strip() for c in cols}
    parts = []
    for d in range(1, 31):
        v = cells.get(d, ".")
        parts.append(f"{d:2d}:{v}")
    line = " ".join(parts)
    shifts = [d for d, v in cells.items() if v.startswith("T")]
    voos = [d for d, v in cells.items() if v == "V"]
    rests = [d for d, v in cells.items() if v in ("F", "FP", "FS", "FAG")]
    lk = [(d, cells[d]) for d, v in cells.items() if v in ("L", "K", "C")]
    print(f"--- {nome} | {r['Cargo']} | grp={grp} | fixo={fixo} ---")
    print(line)
    print(f"  turnos={len(shifts)} voos={len(voos)} folgas={len(rests)} L/K={lk}")
    if grp == "A":
        t2 = [d for d in shifts if d >= 16]
        v2 = [d for d in voos if d >= 16]
        print(f"  Grupo A check: T na 2a quin={t2} | V 16-30={v2} ({len(v2)} dias)")

print("\n=== FUROS ===")
print(f"Total: {len(gaps)}")
if not gaps.empty:
    print(gaps["problema"].value_counts().to_string())
