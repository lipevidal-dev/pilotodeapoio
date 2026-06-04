from io import BytesIO
import pandas as pd

from core.rules import month_range, validate_rules
from database.repositories import (
    schedule_df,
    allocations_df,
    employees_df,
    shifts_df,
    shift_restrictions_df,
)
# We can import these from ui/views/dashboard or coverage modules when we build them, or define a light version/import
# Let's import dynamically inside to avoid circular imports.
# In app.py, coverage_dataframe, coverage_issues_df and employee_monthly_summary are defined.
# We will make sure they are available or define them in exporter_excel or import them from services/coverage or core/rules.
# Let's write them cleanly.

def export_excel(year, month):
    """Gera um arquivo Excel completo contendo todas as planilhas e métricas da competência."""
    # Importações atrasadas para evitar importação circular
    from core.rules import coverage_dataframe, coverage_issues_df, employee_monthly_summary

    start_date, end_date = month_range(year, month)
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        schedule_df(start_date, end_date).to_excel(writer, index=False, sheet_name="Escala")
        allocations_df(start_date, end_date).to_excel(writer, index=False, sheet_name="Pre_Alocacoes")
        validate_rules(year, month).to_excel(writer, index=False, sheet_name="Validacoes")
        employees_df().to_excel(writer, index=False, sheet_name="Funcionarios")
        shifts_df().to_excel(writer, index=False, sheet_name="Turnos")
        shift_restrictions_df(year, month).to_excel(writer, index=False, sheet_name="Restricoes_Turno")
        coverage_dataframe(year, month).to_excel(writer, index=False, sheet_name="Cobertura_Horaria")
        coverage_issues_df(year, month).to_excel(writer, index=False, sheet_name="Falhas_Cobertura")
        employee_monthly_summary(year, month).to_excel(writer, index=False, sheet_name="Resumo_Funcionarios")
    output.seek(0)
    return output

def df_to_csv_bytes(df):
    """Converte um DataFrame para bytes de CSV com codificação UTF-8-SIG."""
    return df.to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig")
