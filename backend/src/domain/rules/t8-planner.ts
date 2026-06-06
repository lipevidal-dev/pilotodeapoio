import type { ScheduleContext, ValidationIssue } from "../schedule/types.js";
import { addDays, isInMonth } from "./dates.js";
import { isEmployeeOnVacation } from "./vacation.js";

/**
 * Valida blocos T8/T8/ND e necessidade de cobertura T8 por dia (porta lógica do t8_planner + T8PairingRule).
 */
export function validateT8Blocks(ctx: ScheduleContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const t8ByEmployee = new Map<number, Set<string>>();
  const ndByEmployee = new Map<number, Set<string>>();

  for (const a of ctx.assignments) {
    if (!isInMonth(a.workDate, ctx.year, ctx.month)) continue;
    if (a.shiftCode === "T8") {
      if (!t8ByEmployee.has(a.employeeId)) t8ByEmployee.set(a.employeeId, new Set());
      t8ByEmployee.get(a.employeeId)!.add(a.workDate);
    }
  }

  for (const al of ctx.allocations) {
    if (!isInMonth(al.allocDate, ctx.year, ctx.month)) continue;
    if (al.allocType === "ND") {
      if (!ndByEmployee.has(al.employeeId)) ndByEmployee.set(al.employeeId, new Set());
      ndByEmployee.get(al.employeeId)!.add(al.allocDate);
    }
  }

  for (const [empId, dates] of t8ByEmployee) {
    const name =
      ctx.assignments.find((x) => x.employeeId === empId)?.employeeName ??
      ctx.employees.find((e) => e.id === empId)?.name ??
      String(empId);

    const sorted = [...dates].sort();
    const dateSet = new Set(sorted);

    for (const currentDay of sorted) {
      if (isEmployeeOnVacation(ctx, empId, currentDay)) continue;

      const prev = addDays(currentDay, -1);
      const next = addDays(currentDay, 1);
      const prevT8 = dateSet.has(prev);
      const nextT8 = dateSet.has(next);

      if (!prevT8 && !nextT8) {
        issues.push({
          severity: "MÉDIA",
          type: "T8 ISOLADO",
          date: currentDay,
          employee: name,
          detail: "T8 deve ser pareado em dois dias consecutivos: T8,T8,ND.",
        });
      }

      if (nextT8) {
        const ndDay = addDays(currentDay, 2);
        if (!isInMonth(ndDay, ctx.year, ctx.month)) continue;
        if (isEmployeeOnVacation(ctx, empId, ndDay)) continue;
        const ndOk = ndByEmployee.get(empId)?.has(ndDay) ?? false;
        if (!ndOk) {
          issues.push({
            severity: "ALTA",
            type: "T8 SEM ND",
            date: ndDay,
            employee: name,
            detail: "Após dois T8 consecutivos, o terceiro dia precisa ser ND.",
          });
        }
      }
    }
  }

  return issues;
}

/** Sugere ND após par T8/T8 (uso futuro do motor de geração). */
export function ndDayAfterT8Pair(firstT8Day: string): string {
  return addDays(firstT8Day, 2);
}

export function dayNeedsT8Coverage(ctx: ScheduleContext, day: string): boolean {
  const count = ctx.assignments.filter(
    (a) => a.workDate === day && a.shiftCode === "T8",
  ).length;
  return count < 1;
}
