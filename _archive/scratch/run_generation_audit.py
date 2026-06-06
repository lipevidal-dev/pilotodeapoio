"""Teste automático de geração + auditoria (jun/2026)."""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from database.connection import set_db_path
from core.scheduler_v2 import generate_unified_schedule, diagnose_capacity
from core.coverage_gate import audit_generation
from core.spreadsheet_validator import list_spreadsheet_gaps, daily_pao_coverage_matrix

REAL_DB = Path.home() / "Sistema_Escala_PAO_APAO_Dados" / "escala.db"
TEMP_DB = ROOT / "_archive" / "scratch" / "escala_audit_temp.db"

YEAR, MONTH = 2026, 6
ROLES = ["PAO", "APAO", "PAO FCF"]


def main():
    if not REAL_DB.exists():
        print(f"DB não encontrado: {REAL_DB}")
        return 1

    TEMP_DB.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(REAL_DB, TEMP_DB)
    set_db_path(TEMP_DB)

    print(f"=== Auditoria geração {MONTH:02d}/{YEAR} ===")
    print(f"DB: {TEMP_DB}")

    diag = diagnose_capacity(YEAR, MONTH)
    print(f"Capacidade: {diag['status_label']} — {diag['message']}")

    log_df = generate_unified_schedule(
        YEAR, MONTH, ROLES, clear_existing=True, auto_loop=True, max_attempts=12,
    )

    audit = audit_generation(YEAR, MONTH)
    gaps_df = list_spreadsheet_gaps(YEAR, MONTH)
    cov_df = daily_pao_coverage_matrix(YEAR, MONTH)
    furos = cov_df[cov_df["status"] == "FURO"] if not cov_df.empty else cov_df

    print("\n--- RESULTADO AUDITORIA ---")
    print(f"Cobertura OK: {audit['coverage_ok']}")
    print(f"Furos PAO T6/T7/T8: {audit['pao_gaps']}")
    print(f"Células vazias: {audit['blanks']}")
    print(f"Violações ALTA+: {audit['violations_alta']}")
    if audit["critical"]:
        print("CRÍTICO:", "; ".join(audit["critical"]))
    if not furos.empty:
        print("\nFuros por dia/turno (primeiros 15):")
        print(furos.head(15).to_string(index=False))
    if not gaps_df.empty:
        print(f"\nGaps planilha: {len(gaps_df)} linha(s)")

    tipos = log_df["tipo"].value_counts() if not log_df.empty else None
    if tipos is not None:
        print("\nLog resumo (top tipos):")
        print(tipos.head(12).to_string())

    gate_ok = any(
        log_df["tipo"].eq("COBERTURA 100%").tolist()
    ) if not log_df.empty else False
    audit_ok = any(
        log_df["tipo"].eq("AUDITORIA OK").tolist()
    ) if not log_df.empty else False

    print(f"\nGate cobertura no log: {'OK' if gate_ok else 'FALHOU'}")
    print(f"Auditoria no log: {'OK' if audit_ok else 'FALHOU'}")

    return 0 if audit["coverage_ok"] and audit["pao_gaps"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
