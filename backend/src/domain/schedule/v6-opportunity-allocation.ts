import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  minimumOpportunityFill,
  type V55MinimumOpportunityReport,
} from "./v5-minimum-opportunity-fill.js";
import type { ValidationIssue } from "./types.js";

export interface V6OpportunityAttemptLog {
  employeeUuid: string;
  name: string;
  date: string;
  shift: string;
  outcome: "OK" | "FAILED";
  reason: string;
}

export interface V6OpportunityAllocationReport {
  attempts: number;
  assigned: number;
  employeesHelped: number;
  stillBelowMin: number;
}

export function clearV6OpportunityAudit(ws: GenerationWorkspace): void {
  ws.v6OpportunityAttemptLog.length = 0;
}

/** @deprecated Use minimumOpportunityFill (V5.5) — mantido para testes legados. */
export function allocateOpportunitiesBelowMinimum(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[],
): V6OpportunityAllocationReport {
  const report: V55MinimumOpportunityReport = minimumOpportunityFill(ws, warnings);
  return {
    attempts: report.totalAttempts,
    assigned: report.totalAccepted,
    employeesHelped: report.employeesHelped,
    stillBelowMin: report.stillBelowMin,
  };
}

export function formatV6OpportunityAudit(ws: GenerationWorkspace): string {
  const lines: string[] = ["===== V6 OPORTUNIDADE ABAIXO DO MÍNIMO (legado → V5.5) =====", ""];
  if (ws.v55MinimumOpportunityAudit.length === 0) {
    lines.push("(nenhuma tentativa registrada)");
    return lines.join("\n");
  }
  for (const row of ws.v55MinimumOpportunityAudit) {
    lines.push(`${row.name} | antes=${row.before} depois=${row.after} aceitas=${row.accepted}`);
  }
  return lines.join("\n");
}