"""Compara furos antes/depois da geracao com 3 camadas."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from services.schedule_service import ScheduleService
from core.scheduler import generate_auto_schedule

year, month = 2026, 6
roles = ["PAO", "APAO", "PAO FCF"]

before = ScheduleService.crosscheck_operational_gaps(year, month)
print(f"FUROS ANTES: {len(before)}")

log = generate_auto_schedule(year, month, roles, clear_existing=True)
after = ScheduleService.crosscheck_operational_gaps(year, month)
quality = ScheduleService.employee_quality_report(year, month)

print(f"FUROS DEPOIS: {len(after)}")
if not log.empty:
    print(f"  Alocados: {len(log[log['tipo']=='ALOCADO'])}")
    print(f"  Reparos: {len(log[log['tipo'].str.startswith('REPARO', na=False)])}")
    print(f"  Excecao quinzena: {len(log[log['detalhe'].str.contains('Exceção quinzena|Excecao quinzena', na=False, regex=True)])}")
    print(f"  SEM COBERTURA no log: {len(log[log['tipo']=='SEM COBERTURA'])}")
if not after.empty:
    print("\nFuros restantes:")
    print(after[["data", "turno", "problema"]].to_string(index=False))
else:
    print("\nCobertura PAO 100%!")
if not quality.empty:
    print(f"\nNota media qualidade: {quality['nota'].mean():.0f}/100")
