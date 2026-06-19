import { addDays } from "../../rules/dates.js";
import {
  IDEAL_PAO_REST_COUNT,
  MAX_CONSECUTIVE_WORK_DAYS,
  MIN_PAO_REST_COUNT,
} from "../../rules/constants.js";
import { isProductiveWorkAllocationLabel } from "../../rules/consecutive.js";
import { parseAssignmentKey } from "../types.js";

/** Até 12 folgas = faixa aceitável no status; 13+ = ATENÇÃO. */
const PAO_FOLGAS_OK_MAX = 12;
import { classifyIssue } from "../violation-level.js";
import type { ValidationIssue } from "../types.js";
import type { EmployeeOperationalSummary } from "./operational-summary.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { normalizeOperationalLabel } from "../operational-labels.js";

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

export interface EmployeeOperationalEvaluation {
  status: OperationalStatus;
  statusReason: string | null;
}

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
  const did = ws.uuidToDomain.get(uuid);
  if (did != null) {
    for (const [key] of ws.historyPlanned.entries()) {
      const parsed = parseAssignmentKey(key);
      if (parsed.employeeId === did) dates.push(parsed.day);
    }
    for (const [key, label] of ws.historyBlocked.entries()) {
      const parsed = parseAssignmentKey(key);
      if (parsed.employeeId !== did) continue;
      if (isProductiveWorkAllocationLabel(label)) dates.push(parsed.day);
    }
  }
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

function formatRuleCode(ruleCode: string): string {
  return ruleCode.trim().replace(/\s+/g, "_").toUpperCase();
}

/** Alertas de escala PAO que não devem afetar o status operacional do APAO. */
const APAO_IGNORED_WARNING_TYPES = new Set([
  "MONOFOLGA",
  "FOLGAS_PEDIDAS",
  "FOLGAS_PAO",
  "SEM_FOLGA_SOCIAL",
]);

function isApaoIgnoredWarning(issue: ValidationIssue): boolean {
  return APAO_IGNORED_WARNING_TYPES.has(formatRuleCode(issue.type));
}

function firstViolationByLevel(
  violations: ValidationIssue[],
  level: ReturnType<typeof classifyIssue>,
): ValidationIssue | undefined {
  return violations.find((v) => classifyIssue(v) === level);
}

/** Faixa operacional saudável PAO — status OK mesmo com 11–12 folgas. */
function isPaoHealthyBand(stats: EmployeeOperationalSummary): boolean {
  return (
    stats.diasTrabalhados >= 18 &&
    stats.diasTrabalhados <= 21 &&
    stats.folgas >= 10 &&
    stats.folgas <= 12 &&
    stats.maxConsec < MAX_CONSECUTIVE_WORK_DAYS
  );
}

export function evaluateEmployeeOperationalStatus(
  stats: EmployeeOperationalSummary,
  violations: ValidationIssue[],
  opts: { daysInMonth: number },
): EmployeeOperationalEvaluation {
  const empViolations = violationsForEmployee(violations, stats.name);
  const criticalViolation = firstViolationByLevel(empViolations, "CRITICAL");
  const warningViolation = firstViolationByLevel(empViolations, "WARNING");
  const hasCritical = criticalViolation != null;
  const hasMonofolga = empViolations.some((v) => v.type === "MONOFOLGA");
  const hasFolgasWarning =
    stats.folgas > PAO_FOLGAS_OK_MAX && empViolations.some((v) => v.type === "FOLGAS PAO");
  const hasMaisDe6Dias = empViolations.some((v) => v.type === "MAIS DE 6 DIAS");

  if (stats.type === "PAO") {
    if (stats.folgas < MIN_PAO_REST_COUNT) {
      return { status: "CRÍTICO", statusReason: `FOLGAS_PAO_BELOW_MIN (${stats.folgas})` };
    }
    if (hasCritical) {
      return { status: "CRÍTICO", statusReason: formatRuleCode(criticalViolation!.type) };
    }
    if (
      empViolations.some(
        (v) =>
          ["ND FORA DE T8/T8", "TURNO EM DIA ND", "TRABALHO EM FÉRIAS", "TRABALHO EM DIA BLOQUEADO"].includes(
            v.type,
          ) && classifyIssue(v) === "CRITICAL",
      )
    ) {
      const hit = empViolations.find(
        (v) =>
          ["ND FORA DE T8/T8", "TURNO EM DIA ND", "TRABALHO EM FÉRIAS", "TRABALHO EM DIA BLOQUEADO"].includes(
            v.type,
          ) && classifyIssue(v) === "CRITICAL",
      )!;
      return { status: "CRÍTICO", statusReason: formatRuleCode(hit.type) };
    }
    if (isPaoHealthyBand(stats)) {
      return { status: "OK", statusReason: null };
    }
    if (stats.folgas > PAO_FOLGAS_OK_MAX) {
      return { status: "ATENÇÃO", statusReason: `FOLGAS_PAO_ABOVE_MAX (${stats.folgas})` };
    }
    if (hasMonofolga) return { status: "ATENÇÃO", statusReason: "MONOFOLGA" };
    if (hasFolgasWarning) return { status: "ATENÇÃO", statusReason: "FOLGAS_PAO" };
    if (!stats.folgaSocialOk) return { status: "ATENÇÃO", statusReason: "SEM_FOLGA_SOCIAL" };
    if (stats.disponivel >= Math.ceil(opts.daysInMonth * 0.35)) {
      return { status: "ATENÇÃO", statusReason: `VOO_DISP_HIGH (${stats.disponivel})` };
    }
    if (stats.turnos < Math.max(12, opts.daysInMonth - IDEAL_PAO_REST_COUNT - 6)) {
      return { status: "ATENÇÃO", statusReason: `TURNOS_BELOW_MIN (${stats.turnos})` };
    }
    if (hasMaisDe6Dias || stats.maxConsec > MAX_CONSECUTIVE_WORK_DAYS) {
      return { status: "ATENÇÃO", statusReason: `MAX_CONSECUTIVE_DAYS (${stats.maxConsec})` };
    }
    if (warningViolation) {
      return { status: "ATENÇÃO", statusReason: formatRuleCode(warningViolation.type) };
    }
    return { status: "OK", statusReason: null };
  }

  if (stats.type === "APAO") {
    const apaoWarnings = empViolations.filter(
      (v) => !isApaoIgnoredWarning(v) && classifyIssue(v) === "WARNING",
    );
    const apaoWarningViolation = apaoWarnings[0];

    if (hasCritical) {
      return { status: "CRÍTICO", statusReason: formatRuleCode(criticalViolation!.type) };
    }
    if (stats.disponivel > 0) {
      return { status: "CRÍTICO", statusReason: `VOO_DISP_APAO (${stats.disponivel})` };
    }
    if (stats.folgas >= 4 && stats.diasTrabalhados >= 24) {
      return { status: "OK", statusReason: null };
    }
    if (stats.maxConsec > MAX_CONSECUTIVE_WORK_DAYS || hasMaisDe6Dias) {
      return { status: "ATENÇÃO", statusReason: `MAX_CONSECUTIVE_DAYS (${stats.maxConsec})` };
    }
    if (apaoWarningViolation) {
      return { status: "ATENÇÃO", statusReason: formatRuleCode(apaoWarningViolation.type) };
    }
    return { status: "OK", statusReason: null };
  }

  if (hasCritical) {
    return { status: "CRÍTICO", statusReason: formatRuleCode(criticalViolation!.type) };
  }
  if (hasMonofolga) {
    return { status: "ATENÇÃO", statusReason: "MONOFOLGA" };
  }
  if (stats.folgas > PAO_FOLGAS_OK_MAX) {
    return { status: "ATENÇÃO", statusReason: `FOLGAS_PAO_ABOVE_MAX (${stats.folgas})` };
  }
  if (warningViolation) {
    return { status: "ATENÇÃO", statusReason: formatRuleCode(warningViolation.type) };
  }
  return { status: "OK", statusReason: null };
}

export function computeEmployeeStatus(
  stats: EmployeeOperationalSummary,
  violations: ValidationIssue[],
  opts: { daysInMonth: number },
): OperationalStatus {
  return evaluateEmployeeOperationalStatus(stats, violations, opts).status;
}
