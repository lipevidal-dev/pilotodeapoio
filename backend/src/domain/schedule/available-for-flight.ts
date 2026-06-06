import { iterDays } from "../rules/dates.js";
import { assignmentKey } from "./types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ScheduleContext } from "./types.js";

/** Dia completamente livre — candidato a voo. */
export function isPaoDayDisponivel(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const hasAssignment = ws.planned.has(assignmentKey(did, day));
  const hasAllocation = ws.allocations.some((a) => a.employeeUuid === uuid && a.date === day);
  return !hasAssignment && !hasAllocation;
}

export function listAvailableForFlightFromWorkspace(
  ws: GenerationWorkspace,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of ws.paoEmps) {
    const days = ws.days.filter((d) => isPaoDayDisponivel(ws, e.uuid, d));
    out.set(e.uuid, days);
  }
  return out;
}

export function countDisponivelInContext(ctx: ScheduleContext, employeeId: number): number {
  const days = iterDays(ctx.year, ctx.month);
  let n = 0;
  for (const day of days) {
    const hasAssignment = ctx.assignments.some(
      (a) => a.employeeId === employeeId && a.workDate === day,
    );
    const hasAllocation = ctx.allocations.some(
      (a) => a.employeeId === employeeId && a.allocDate === day,
    );
    if (!hasAssignment && !hasAllocation) n++;
  }
  return n;
}
