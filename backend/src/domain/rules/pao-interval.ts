import type { ShiftMap } from "../shift/types.js";
import type { PlannedMap } from "../schedule/types.js";
import { parseAssignmentKey } from "../schedule/types.js";
import { roleForShift, shiftStartEnd } from "./time.js";

/**
 * O intervalo candStart→candEnd está 100% coberto por turnos de PAO regular (não FCF)?
 */
export function intervalCoveredByPao(
  candStart: Date,
  candEnd: Date,
  planned: PlannedMap,
  shiftMap: ShiftMap,
  roleByEmployeeId: Map<number, string>,
): boolean {
  const segments: { start: Date; end: Date }[] = [];

  for (const [key, shiftCode] of planned) {
    if (roleForShift(shiftCode, shiftMap) !== "PAO") continue;
    const { employeeId, day } = parseAssignmentKey(key);
    if (roleByEmployeeId.get(employeeId) === "PAO FCF") continue;

    const info = shiftMap[shiftCode];
    if (!info) continue;

    const { start, end } = shiftStartEnd(day, info.startTime, info.endTime);
    if (end > candStart && start < candEnd) {
      segments.push({
        start: start > candStart ? start : candStart,
        end: end < candEnd ? end : candEnd,
      });
    }
  }

  if (segments.length === 0) return false;

  segments.sort((a, b) => a.start.getTime() - b.start.getTime());

  let current = candStart;
  for (const { start, end } of segments) {
    if (start > current) return false;
    if (end > current) current = end;
    if (current >= candEnd) return true;
  }

  return current >= candEnd;
}
