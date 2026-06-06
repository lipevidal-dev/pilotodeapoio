import { addDays } from "../rules/dates.js";
import {
  IDEAL_PAO_REST_COUNT,
  MAX_PAO_REST_COUNT,
  MIN_PAO_REST_COUNT,
} from "../rules/constants.js";
import { classifyIssue } from "./violation-level.js";
import type { ValidationIssue } from "./types.js";
import type { EmployeeOperationalSummary } from "./operational-summary.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { normalizeOperationalLabel } from "./operational-labels.js";

export type OperationalStatus = "OK" | "ATENÇÃO" | "CRÍTICO";

const WORK_ALLOC_LABELS = new Set([
  "ND",
  "VOO",
  "SIMULADOR",
  "CURSO",
  "CURSO ONLINE",
  "CMA",
  "OUTRO",
]);

/** Dia central da maior sequência consecutiva (para quebra de streak). */
export function longestStreakMiddleDay(dates: string[], minLength = 1): string | null {
  if (dates.length === 0) return null;
  const sorted = [...new Set(dates)].sort();
  let bestStart = 0;
  let bestLen = 1;
  let start = 0;
  let len = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === addDays(sorted[i - 1], 1)) {
      len++;
    } else {
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
      start = i;
      len = 1;
    }
  }
  if (len > bestLen) {
    bestLen = len;
    bestStart = start;
  }
  if (bestLen < minLength) return null;
  const mid = bestStart + Math.floor(bestLen / 2);
  return sorted[mid] ?? null;
}

/** Maior sequência de dias trabalhados consecutivos. */
export function maxConsecutiveWorkDays(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let max = 1;
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === addDays(sorted[i - 1], 1)) {
      streak++;
      max = Math.max(max, streak);
    } else {
      streak = 1;
    }
  }
  return max;
}

export function workDatesFromWorkspace(ws: GenerationWorkspace, uuid: string): string[] {
  const dates: string[] = [];
  for (const a of ws.toAssignments()) {
    if (a.employeeUuid === uuid) dates.push(a.date);
  }
  for (const al of ws.allocations) {
    if (al.employeeUuid !== uuid) continue;
    const n = normalizeOperationalLabel(al.label).toUpperCase();
    if (WORK_ALLOC_LABELS.has(n)) dates.push(al.date);
  }
  return dates;
}

export function coveragePercentages(
  ws: GenerationWorkspace,
): { t6: number; t7: number; t8: number } {
  const days = ws.days.length;
  if (days === 0) return { t6: 0, t7: 0, t8: 0 };
  let t6 = 0;
  let t7 = 0;
  let t8 = 0;
  for (const day of ws.days) {
    if (ws.hasPaoCoverage(day, "T6")) t6++;
    if (ws.hasPaoCoverage(day, "T7")) t7++;
    if (ws.hasPaoCoverage(day, "T8")) t8++;
  }
  const pct = (n: number) => Math.round((n / days) * 100);
  return { t6: pct(t6), t7: pct(t7), t8: pct(t8) };
}

function violationsForEmployee(
  violations: ValidationIssue[],
  employeeName: string,
): ValidationIssue[] {
  return violations.filter((v) => v.employee === employeeName);
}

export function computeEmployeeStatus(
  stats: EmployeeOperationalSummary,
  violations: ValidationIssue[],
  opts: { daysInMonth: number },
): OperationalStatus {
  const empViolations = violationsForEmployee(violations, stats.name);
  const hasCritical = empViolations.some((v) => classifyIssue(v) === "CRITICAL");
  const hasMonofolga = empViolations.some((v) => v.type === "MONOFOLGA");
  const hasFolgasWarning = empViolations.some((v) => v.type === "FOLGAS PAO");

  if (stats.type === "PAO") {
    if (stats.folgas < MIN_PAO_REST_COUNT || stats.folgas > MAX_PAO_REST_COUNT) {
      return "CRÍTICO";
    }
    if (hasCritical) return "CRÍTICO";
    if (
      empViolations.some(
        (v) =>
          ["ND FORA DE T8/T8", "TURNO EM DIA ND", "TRABALHO EM FÉRIAS", "TRABALHO EM DIA BLOQUEADO"].includes(
            v.type,
          ) && classifyIssue(v) === "CRITICAL",
      )
    ) {
      return "CRÍTICO";
    }
    if (
      stats.folgasAjusteOperacional ||
      hasMonofolga ||
      hasFolgasWarning ||
      !stats.folgaSocialOk ||
      stats.disponivel >= Math.ceil(opts.daysInMonth * 0.35) ||
      stats.turnos < Math.max(12, opts.daysInMonth - IDEAL_PAO_REST_COUNT - 6)
    ) {
      return "ATENÇÃO";
    }
    return "OK";
  }

  if (stats.type === "APAO") {
    if (hasCritical) return "CRÍTICO";
    if (stats.disponivel > 0) return "CRÍTICO";
    if (stats.maxConsec > 6 || hasMonofolga) return "ATENÇÃO";
    return "OK";
  }

  if (hasCritical) return "CRÍTICO";
  if (hasMonofolga || stats.folgasAjusteOperacional) return "ATENÇÃO";
  return "OK";
}
