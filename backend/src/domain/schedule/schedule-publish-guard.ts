import { validateSchedule } from "../rules/engine.js";
import { runFinalCoverageGate } from "../rules/coverage-gate.js";
import type { ScheduleContext, ValidationIssue } from "./types.js";
import { filterByLevel, type ClassifiedViolation, type ViolationLevel } from "./violation-level.js";

export interface PublishGuardResult {
  canPublish: boolean;
  criticalViolations: ClassifiedViolation[];
  warningViolations: ClassifiedViolation[];
  infoViolations: ClassifiedViolation[];
  allIssues: ValidationIssue[];
}

export function evaluatePublishReadiness(ctx: ScheduleContext): PublishGuardResult {
  const engineIssues = validateSchedule(ctx);
  const gate = runFinalCoverageGate(ctx);

  const merged = [...engineIssues, ...gate.issues];
  const seen = new Set<string>();
  const allIssues = merged.filter((i) => {
    const k = `${i.type}|${i.date}|${i.employee}|${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const criticalViolations = filterByLevel(allIssues, ["CRITICAL"]);
  const warningViolations = filterByLevel(allIssues, ["WARNING"]);
  const infoViolations = filterByLevel(allIssues, ["INFO"]);

  return {
    canPublish: criticalViolations.length === 0,
    criticalViolations,
    warningViolations,
    infoViolations,
    allIssues,
  };
}

export function dbSeverityToLevel(severity: string): ViolationLevel {
  const s = severity.toUpperCase();
  if (s === "CRITICAL" || s === "CRITICA") return "CRITICAL";
  if (s === "WARNING" || s === "MEDIA") return "WARNING";
  return "INFO";
}

export function mergeDbCriticalViolations(
  rows: Array<{ severity: string; ruleCode: string; message: string; date: string | null; employeeId: string | null }>,
  employeeNames: Map<string, string>,
): ClassifiedViolation[] {
  return rows
    .filter((r) => dbSeverityToLevel(r.severity) === "CRITICAL")
    .map((r) => ({
      level: "CRITICAL" as const,
      ruleCode: r.ruleCode,
      message: r.message,
      date: r.date ?? "-",
      employee: r.employeeId ? (employeeNames.get(r.employeeId) ?? r.employeeId) : "-",
      detail: r.message,
    }));
}
