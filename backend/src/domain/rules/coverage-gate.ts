import type { ScheduleContext, ValidationIssue } from "../schedule/types.js";
import { listPaoCoverageGaps } from "./coverage.js";
import { validateT8Blocks } from "./t8-planner.js";
import { coverageRuleCode } from "../schedule/violation-level.js";

export interface CoverageGateResult {
  ok: boolean;
  gaps: number;
  message: string;
  issues: ValidationIssue[];
}

/**
 * Gate final obrigatório: cada dia deve ter T6, T7 e T8 com PAO.
 */
export function runFinalCoverageGate(ctx: ScheduleContext): CoverageGateResult {
  const gaps = listPaoCoverageGaps(ctx);
  const issues: ValidationIssue[] = [];

  for (const g of gaps) {
    issues.push({
      severity: "CRÍTICA",
      level: "CRITICAL",
      type: coverageRuleCode(g.shiftCode),
      date: g.date,
      employee: "-",
      detail: `Sem PAO em ${g.shiftCode} no dia ${g.date}.`,
    });
  }

  const t8Issues = validateT8Blocks(ctx).map((i) => ({
    ...i,
    level: (i.type === "T8 SEM ND" || i.type === "T8 ISOLADO" ? "CRITICAL" : i.level) as
      | "CRITICAL"
      | "WARNING"
      | "INFO"
      | undefined,
  }));

  const all = [...issues, ...t8Issues];
  const gapCount = gaps.length;

  return {
    ok: gapCount === 0 && !t8Issues.some((i) => i.level === "CRITICAL"),
    gaps: gapCount,
    message:
      gapCount === 0
        ? "Cobertura PAO T6/T7/T8: 100%."
        : `${gapCount} furo(s) de cobertura PAO (T6/T7/T8).`,
    issues: all,
  };
}

/** @deprecated Use runFinalCoverageGate */
export function runCoverageGate(ctx: ScheduleContext): CoverageGateResult {
  return runFinalCoverageGate(ctx);
}

export function enforceFullCoverageReport(ctx: ScheduleContext): {
  ok: boolean;
  gaps: number;
} {
  const gaps = listPaoCoverageGaps(ctx).length;
  return { ok: gaps === 0, gaps };
}
