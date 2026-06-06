import { iterDays } from "../rules/dates.js";
import {
  buildMainBlockingReasons,
  detectImpossibleScenario,
} from "./generation-insights.js";
import { filterByLevel } from "./violation-level.js";
import type { GenerationResult, GenerationSummary } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  buildOperationalSummary,
  type EmployeeOperationalSummary,
  type OperationalTotals,
} from "./operational-summary.js";
import type { ValidationIssue } from "./types.js";
import { analyzeT6T7BlockCoverage } from "./coverage-block-metrics.js";

export interface ExtendedGenerationSummary extends GenerationSummary {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  coverageMissingCount: number;
  employeesUsed: number;
  paosUsed: number;
  apaosUsed: number;
  daysInMonth: number;
  generatedAt: string;
  workloadByEmployee?: Record<string, number>;
  shiftsByCode?: Record<string, number>;
  daysWithFullCoverage?: number;
  impossibleScenario?: boolean;
  mainBlockingReasons?: string[];
  generationMs?: number;
  operationalByEmployee?: EmployeeOperationalSummary[];
  operationalTotals?: OperationalTotals;
  mathClosureOk?: boolean;
  mathClosureErrors?: string[];
  paosCom11Folgas?: string[];
  t6BlockCoverage?: {
    blockCount: number;
    averageDays: number;
    unitOccurrences: number;
  };
  t7BlockCoverage?: {
    blockCount: number;
    averageDays: number;
    unitOccurrences: number;
  };
  unitCoverageTotal?: number;
  motorVersion?: string;
  enginePath?: string;
  realEngineExecuted?: boolean;
  realMotorReport?: Record<string, unknown>;
}

export function buildExtendedSummary(
  ws: GenerationWorkspace,
  violations: ValidationIssue[],
  base: Omit<
    GenerationSummary,
    "blockingViolations" | "criticalViolations" | "totalViolations" | "valid"
  > & {
    repairsApplied?: number;
    repairRemainingGaps?: number;
    valid?: boolean;
    generationMs?: number;
    impossibleScenario?: boolean;
    mainBlockingReasons?: string[];
  },
): ExtendedGenerationSummary {
  const critical = filterByLevel(violations, ["CRITICAL"]);
  const warning = filterByLevel(violations, ["WARNING"]);
  const info = filterByLevel(violations, ["INFO"]);
  const gaps = ws.listCoverageGaps();

  const workloadByEmployee: Record<string, number> = {};
  const shiftsByCode: Record<string, number> = {};
  const usedUuids = new Set<string>();

  for (const a of ws.toAssignments()) {
    usedUuids.add(a.employeeUuid);
    const emp = ws.input.employees.find((e) => e.uuid === a.employeeUuid);
    const name = emp?.employee.name ?? a.employeeUuid;
    workloadByEmployee[name] = (workloadByEmployee[name] ?? 0) + 1;
    shiftsByCode[a.shiftCode] = (shiftsByCode[a.shiftCode] ?? 0) + 1;
  }

  const days = iterDays(ws.input.year, ws.input.month);
  let daysWithFullCoverage = 0;
  for (const day of days) {
    if (
      ws.hasPaoCoverage(day, "T6") &&
      ws.hasPaoCoverage(day, "T7") &&
      ws.hasPaoCoverage(day, "T8")
    ) {
      daysWithFullCoverage++;
    }
  }

  const paosUsed = new Set(
    ws.toAssignments()
      .filter((a) => ws.paoEmps.some((p) => p.uuid === a.employeeUuid))
      .map((a) => a.employeeUuid),
  ).size;

  const apaosUsed = new Set(
    ws.toAssignments()
      .filter((a) => ws.apaoEmps.some((p) => p.uuid === a.employeeUuid))
      .map((a) => a.employeeUuid),
  ).size;

  const coverageMissingCount = gaps.length;
  const impossibleScenario =
    base.impossibleScenario ??
    detectImpossibleScenario(ws, violations, coverageMissingCount);
  const mainBlockingReasons =
    base.mainBlockingReasons ??
    buildMainBlockingReasons(violations, coverageMissingCount, base.repairRemainingGaps ?? 0);

  const operational = buildOperationalSummary(ws, violations);
  const blockCoverage = analyzeT6T7BlockCoverage(ws.toAssignments(), days);

  return {
    ...base,
    totalViolations: violations.length,
    blockingViolations: critical.length,
    criticalViolations: critical.length,
    criticalCount: critical.length,
    warningCount: warning.length,
    infoCount: info.length,
    coverageMissingCount,
    coverageGaps: coverageMissingCount,
    employeesUsed: usedUuids.size,
    paosUsed,
    apaosUsed,
    daysInMonth: days.length,
    generatedAt: new Date().toISOString(),
    workloadByEmployee,
    shiftsByCode,
    daysWithFullCoverage,
    impossibleScenario,
    mainBlockingReasons,
    operationalByEmployee: operational.byEmployee,
    operationalTotals: operational.totals,
    mathClosureOk: operational.mathClosureOk,
    mathClosureErrors: operational.mathClosureErrors,
    paosCom11Folgas: operational.byEmployee
      .filter((e) => e.folgasAjusteOperacional)
      .map((e) => e.name),
    t6BlockCoverage: {
      blockCount: blockCoverage.T6.blockCount,
      averageDays: blockCoverage.T6.averageBlockSize,
      unitOccurrences: blockCoverage.T6.unitCoverageCount,
    },
    t7BlockCoverage: {
      blockCount: blockCoverage.T7.blockCount,
      averageDays: blockCoverage.T7.averageBlockSize,
      unitOccurrences: blockCoverage.T7.unitCoverageCount,
    },
    unitCoverageTotal: blockCoverage.unitCoverageTotal,
    valid: critical.length === 0 && coverageMissingCount === 0,
  };
}

export function resultToExtendedSummary(result: GenerationResult): ExtendedGenerationSummary {
  const critical = filterByLevel(result.violations, ["CRITICAL"]);
  const warning = filterByLevel(result.violations, ["WARNING"]);
  const info = filterByLevel(result.violations, ["INFO"]);

  return {
    ...result.summary,
    criticalCount: critical.length,
    warningCount: warning.length,
    infoCount: info.length,
    coverageMissingCount: result.summary.coverageGaps,
    employeesUsed: 0,
    paosUsed: result.summary.paoCount,
    apaosUsed: result.summary.apaoCount,
    daysInMonth: 30,
    generatedAt: new Date().toISOString(),
    valid: result.summary.valid,
  };
}
