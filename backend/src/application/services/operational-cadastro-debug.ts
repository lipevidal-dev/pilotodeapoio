import type { OperationalCadastroDisplay } from "../mappers/operational-cadastro-display.mapper.js";

export interface OperationalCadastroDebugSummary {
  year: number;
  month: number;
  totals: Record<string, number>;
  items: Array<{
    employeeId: string;
    employeeName?: string;
    date: string;
    label: string;
    source: string;
  }>;
}

export function buildOperationalCadastroDebugSummary(
  year: number,
  month: number,
  rows: OperationalCadastroDisplay[],
  employeeNames?: Map<string, string>,
): OperationalCadastroDebugSummary {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.label] = (totals[row.label] ?? 0) + 1;
  }

  return {
    year,
    month,
    totals,
    items: rows.map((row) => ({
      employeeId: row.employeeId,
      employeeName: employeeNames?.get(row.employeeId),
      date: row.date,
      label: row.label,
      source: row.source,
    })),
  };
}

export function logOperationalCadastroDebug(
  year: number,
  month: number,
  rows: OperationalCadastroDisplay[],
): void {
  if (process.env.DEBUG_OPERATIONAL_CADASTROS !== "true") return;
  const summary = buildOperationalCadastroDebugSummary(year, month, rows);
  console.info("[operational-cadastros]", JSON.stringify(summary, null, 2));
}
