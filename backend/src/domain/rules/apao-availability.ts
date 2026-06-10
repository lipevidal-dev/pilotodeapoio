import { BLOCK_TYPES } from "./constants.js";
import { isInMonth, iterDays } from "./dates.js";
import { normalizeOperationalLabel } from "../schedule/operational-labels.js";
import type { ScheduleContext } from "../schedule/types.js";
import { buildRoleMap } from "./coverage.js";

/** Tipos que impedem APAO de cobrir o escritório no dia. */
export const APAO_UNAVAILABLE_TYPES = new Set<string>([
  ...BLOCK_TYPES,
  "FANI",
]);

export function isApaoBlockingAllocation(allocType: string): boolean {
  const n = normalizeOperationalLabel(allocType).toUpperCase();
  if (APAO_UNAVAILABLE_TYPES.has(n)) return true;
  if (n.includes("FOLGA")) return true;
  if (n.includes("FERIAS") || n.includes("FÉRIAS")) return true;
  return false;
}

export function isApaoEmployeeAvailableOnDay(
  ctx: ScheduleContext,
  employeeId: number,
  day: string,
): boolean {
  const blocked = ctx.allocations.some(
    (a) =>
      a.employeeId === employeeId &&
      a.allocDate === day &&
      isApaoBlockingAllocation(a.allocType),
  );
  if (blocked) return false;
  const working = ctx.assignments.some(
    (a) => a.employeeId === employeeId && a.workDate === day,
  );
  return !working;
}

export function countAvailableApaosOnDay(ctx: ScheduleContext, day: string): number {
  let count = 0;
  for (const emp of ctx.employees) {
    if (emp.role !== "APAO") continue;
    if (isApaoEmployeeAvailableOnDay(ctx, emp.id, day)) count++;
  }
  return count;
}

export function dayRequiresApaoCoverage(ctx: ScheduleContext, day: string): boolean {
  const roleMap = buildRoleMap(ctx);
  return ctx.assignments.some(
    (a) =>
      a.workDate === day &&
      a.shiftCode === "T6" &&
      roleMap.get(a.employeeId) === "PAO",
  );
}

export function listDaysWithoutAvailableApao(ctx: ScheduleContext): string[] {
  const hasApao = ctx.employees.some((e) => e.role === "APAO");
  if (!hasApao) return [];

  const missing: string[] = [];
  for (const day of iterDays(ctx.year, ctx.month)) {
    if (!dayRequiresApaoCoverage(ctx, day)) continue;
    if (countAvailableApaosOnDay(ctx, day) < 1) {
      missing.push(day);
    }
  }
  return missing;
}

export function folgaAgrupadaDatesInMonth(ctx: ScheduleContext): Set<string> {
  const dates = new Set<string>();
  for (const a of ctx.allocations) {
    if (!isInMonth(a.allocDate, ctx.year, ctx.month)) continue;
    if (normalizeOperationalLabel(a.allocType).toUpperCase() !== "FOLGA AGRUPADA") continue;
    dates.add(a.allocDate);
  }
  return dates;
}

export function hasFolgaAgrupadaOnDate(ctx: ScheduleContext, date: string): boolean {
  return folgaAgrupadaDatesInMonth(ctx).has(date);
}

export function wouldApaoFolgaBlockOffice(
  ctx: ScheduleContext,
  employeeId: number,
  dates: string[],
): boolean {
  const roleMap = buildRoleMap(ctx);
  if (roleMap.get(employeeId) !== "APAO") return false;

  for (const day of iterDays(ctx.year, ctx.month)) {
    if (!dayRequiresApaoCoverage(ctx, day)) continue;

    let available = countAvailableApaosOnDay(ctx, day);
    if (dates.includes(day) && isApaoEmployeeAvailableOnDay(ctx, employeeId, day)) {
      available -= 1;
    }
    if (available < 1) return true;
  }
  return false;
}
