import type { ScheduleContext } from "../schedule/types.js";
import { VACATION_TYPES } from "./constants.js";
import { iterDays, isInMonth } from "./dates.js";

export function employeeVacationDates(
  ctx: ScheduleContext,
  employeeId: number,
): Set<string> {
  const dates = new Set<string>();
  for (const a of ctx.allocations) {
    if (a.employeeId !== employeeId) continue;
    if (!VACATION_TYPES.has(a.allocType.toUpperCase())) continue;
    if (isInMonth(a.allocDate, ctx.year, ctx.month)) {
      dates.add(a.allocDate);
    }
  }
  return dates;
}

export function isEmployeeOnVacation(
  ctx: ScheduleContext,
  employeeId: number,
  day: string,
): boolean {
  return ctx.allocations.some(
    (a) =>
      a.employeeId === employeeId &&
      a.allocDate === day &&
      VACATION_TYPES.has(a.allocType.toUpperCase()),
  );
}

export function isEmployeePlanningActiveMonth(
  ctx: ScheduleContext,
  employeeId: number,
): boolean {
  const vac = employeeVacationDates(ctx, employeeId);
  const monthDays = iterDays(ctx.year, ctx.month);
  return monthDays.some((d) => !vac.has(d));
}

export function isEmployeeInPlanning(
  ctx: ScheduleContext,
  employeeId: number,
  day: string,
): boolean {
  return !isEmployeeOnVacation(ctx, employeeId, day);
}
