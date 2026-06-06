import type { ShiftMap } from "../shift/types.js";
import { parseDate } from "./dates.js";
import { assignmentKey, parseAssignmentKey, type PlannedMap } from "../schedule/types.js";

export interface DateTimeRange {
  start: Date;
  end: Date;
}

export function parseHhmm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

export function shiftStartEnd(workDayIso: string, startTime: string, endTime: string): DateTimeRange {
  const day = parseDate(workDayIso);
  const sh = parseHhmm(startTime);
  const eh = parseHhmm(endTime);

  const start = new Date(day);
  start.setHours(sh.hour, sh.minute, 0, 0);

  const end = new Date(day);
  end.setHours(eh.hour, eh.minute, 0, 0);

  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

export function roleForShift(shiftCode: string, shiftMap: ShiftMap): string {
  return shiftMap[shiftCode]?.role ?? "";
}

export function has12hRest(
  employeeId: number,
  workDay: string,
  shiftCode: string,
  planned: PlannedMap,
  shiftMap: ShiftMap,
): { ok: boolean; reason: string } {
  const info = shiftMap[shiftCode];
  if (!info) return { ok: true, reason: "" };

  const { start: candStart, end: candEnd } = shiftStartEnd(workDay, info.startTime, info.endTime);

  for (const [key, otherShift] of planned) {
    const { employeeId: otherId, day: otherDay } = parseAssignmentKey(key);
    if (otherId !== employeeId) continue;
    const otherInfo = shiftMap[otherShift];
    if (!otherInfo) continue;

    const { start: otherStart, end: otherEnd } = shiftStartEnd(otherDay, otherInfo.startTime, otherInfo.endTime);

    if (candStart >= otherEnd) {
      const restHours = (candStart.getTime() - otherEnd.getTime()) / 3_600_000;
      if (restHours < 12) {
        return { ok: false, reason: `descanso de apenas ${restHours.toFixed(1)}h após ${otherShift}` };
      }
    } else if (otherStart >= candEnd) {
      const restHours = (otherStart.getTime() - candEnd.getTime()) / 3_600_000;
      if (restHours < 12) {
        return { ok: false, reason: `descanso de apenas ${restHours.toFixed(1)}h antes de ${otherShift}` };
      }
    } else {
      return { ok: false, reason: `sobreposição com ${otherShift}` };
    }
  }

  return { ok: true, reason: "" };
}

export function maxSimultaneousWorkersIfAdded(
  employeeId: number,
  workDay: string,
  shiftCode: string,
  planned: PlannedMap,
  shiftMap: ShiftMap,
  roleByEmployeeId: Map<number, string>,
): number {
  type Event = { time: Date; delta: number };
  const events: Event[] = [];

  const pushInterval = (eid: number, day: string, code: string) => {
    if (code === "T9" || code === "T09") return;
    if (roleByEmployeeId.get(eid) === "PAO FCF") return;
    const info = shiftMap[code];
    if (!info) return;
    const { start, end } = shiftStartEnd(day, info.startTime, info.endTime);
    events.push({ time: start, delta: 1 });
    events.push({ time: end, delta: -1 });
  };

  for (const [key, code] of planned) {
    const { employeeId: eid, day } = parseAssignmentKey(key);
    pushInterval(eid, day, code);
  }

  if (roleByEmployeeId.get(employeeId) !== "PAO FCF" && shiftCode !== "T9" && shiftCode !== "T09") {
    pushInterval(employeeId, workDay, shiftCode);
  }

  events.sort((a, b) => a.time.getTime() - b.time.getTime() || a.delta - b.delta);

  let current = 0;
  let max = 0;
  for (const e of events) {
    current += e.delta;
    max = Math.max(max, current);
  }
  return max;
}

export function t8PreviousCount(employeeId: number, workDay: string, planned: PlannedMap): number {
  let count = 0;
  let d = addDaysIso(workDay, -1);
  while (planned.get(assignmentKey(employeeId, d)) === "T8") {
    count++;
    d = addDaysIso(d, -1);
  }
  return count;
}

function addDaysIso(iso: string, delta: number): string {
  const dt = parseDate(iso);
  dt.setDate(dt.getDate() + delta);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
