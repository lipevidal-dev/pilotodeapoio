import type { ShiftMap } from "../shift/types.js";
import type { ScheduleContext } from "../schedule/types.js";
import {
  assignmentKey,
  parseAssignmentKey,
  type PlannedMap,
  type BlockedMap,
} from "../schedule/types.js";
import { addDays } from "./dates.js";
import { normalizeOperationalLabel } from "../schedule/operational-labels.js";
import { shiftStartEnd } from "./time.js";

/** Labels de pré-alocação que contam como dia trabalhado na continuidade 6x1. */
const PRODUCTIVE_WORK_ALLOC_LABELS = new Set([
  "ND",
  "VOO",
  "SIMULADOR",
  "CURSO",
  "CURSO ONLINE",
  "CMA",
  "OUTRO",
]);

export function isProductiveWorkAllocationLabel(label: string | undefined): boolean {
  if (!label) return false;
  const n = normalizeOperationalLabel(label).toUpperCase();
  return PRODUCTIVE_WORK_ALLOC_LABELS.has(n);
}

export function buildPlannedWithHistory(ctx: ScheduleContext): PlannedMap {
  const planned: PlannedMap = new Map();
  for (const a of ctx.previousMonthAssignments ?? []) {
    planned.set(assignmentKey(a.employeeId, a.workDate), a.shiftCode);
  }
  for (const a of ctx.assignments) {
    planned.set(assignmentKey(a.employeeId, a.workDate), a.shiftCode);
  }
  return planned;
}

export function consecutiveWorkCount(
  employeeId: number,
  workDay: string,
  planned: PlannedMap,
  blocked?: BlockedMap,
): number {
  let count = 0;
  let d = addDays(workDay, -1);

  while (true) {
    const key = assignmentKey(employeeId, d);
    if (planned.has(key)) {
      count++;
    } else if (blocked && isProductiveWorkAllocationLabel(blocked.get(key))) {
      count++;
    } else {
      break;
    }
    d = addDays(d, -1);
  }

  return count;
}

export function apaoHasNoOtherApaoOverlap(
  employeeId: number,
  workDay: string,
  shiftCode: string,
  planned: PlannedMap,
  shiftMap: ShiftMap,
): boolean {
  const info = shiftMap[shiftCode];
  if (!info) return true;

  const { start: candStart, end: candEnd } = shiftStartEnd(workDay, info.startTime, info.endTime);

  for (const [key, otherShift] of planned) {
    const { employeeId: otherId, day: otherDay } = parseAssignmentKey(key);
    if (otherId === employeeId) continue;
    const otherInfo = shiftMap[otherShift];
    if (!otherInfo || otherInfo.role !== "APAO") continue;

    const { start: otherStart, end: otherEnd } = shiftStartEnd(
      otherDay,
      otherInfo.startTime,
      otherInfo.endTime,
    );

    if (candStart < otherEnd && candEnd > otherStart) {
      return false;
    }
  }
  return true;
}
