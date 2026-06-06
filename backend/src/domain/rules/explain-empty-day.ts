import type { Employee } from "../employee/types.js";
import type { BlockedMap, ScheduleContext } from "../schedule/types.js";
import { assignmentKey } from "../schedule/types.js";
import { IDEAL_PAO_REST_COUNT, PAO_COVERAGE_SHIFTS, PAO_REST_TYPES } from "./constants.js";
import { buildPlannedWithHistory } from "./consecutive.js";
import { canWorkInContext } from "./eligibility.js";

function buildBlockedFromContext(ctx: ScheduleContext): BlockedMap {
  const blocked: BlockedMap = new Map();
  for (const al of ctx.allocations) {
    blocked.set(assignmentKey(al.employeeId, al.allocDate), al.allocType);
  }
  return blocked;
}

function countRestInContext(ctx: ScheduleContext, employeeId: number): number {
  const restSet = new Set(PAO_REST_TYPES.map((t) => t.toUpperCase()));
  return ctx.allocations.filter(
    (a) => a.employeeId === employeeId && restSet.has(a.allocType.toUpperCase()),
  ).length;
}

export function explainEmptyPaoDay(ctx: ScheduleContext, emp: Employee, day: string): string {
  const blocked = buildBlockedFromContext(ctx);

  if (countRestInContext(ctx, emp.id) < IDEAL_PAO_REST_COUNT) {
    return "faltam folgas para completar 10 — dia livre sem folga alocada";
  }

  const reasons: string[] = [];
  for (const code of PAO_COVERAGE_SHIFTS) {
    const r = canWorkInContext(ctx, emp, day, code, blocked, buildPlannedWithHistory(ctx));
    if (!r.ok) reasons.push(`${code}: ${r.reason}`);
  }

  if (reasons.length === 0) {
    return "nenhuma opção válida após verificação de elegibilidade";
  }
  return reasons.slice(0, 3).join("; ");
}
