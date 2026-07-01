import type { ShiftMap } from "../shift/types.js";
import type { ScheduleContext } from "../schedule/types.js";
import { PAO_COVERAGE_SHIFTS } from "./constants.js";
import { baseShiftCode, isInstructionShiftCode } from "../schedule/instruction-shift.js";
import { iterDays, isInMonth } from "./dates.js";
import { roleForShift, shiftStartEnd } from "./time.js";
import { intervalCoveredByPao } from "./pao-interval.js";
import type { PlannedMap } from "../schedule/types.js";
import { assignmentKey } from "../schedule/types.js";

export interface PaoCoverageGap {
  date: string;
  shiftCode: string;
}

export function buildPlannedMap(ctx: ScheduleContext): PlannedMap {
  const planned: PlannedMap = new Map();
  const all = [...(ctx.previousMonthAssignments ?? []), ...ctx.assignments];
  for (const a of all) {
    planned.set(assignmentKey(a.employeeId, a.workDate), a.shiftCode);
  }
  return planned;
}

export function buildRoleMap(ctx: ScheduleContext): Map<number, string> {
  const m = new Map<number, string>();
  for (const e of ctx.employees) {
    m.set(e.id, e.role);
  }
  return m;
}

export function buildShiftMapFromContext(ctx: ScheduleContext): ShiftMap {
  const map: ShiftMap = {};
  for (const s of ctx.shifts) {
    map[s.code] = {
      startTime: s.startTime,
      endTime: s.endTime,
      role: s.role,
      noWeekends: Boolean(s.noWeekends),
    };
  }
  return map;
}

/** Furos PAO: dias sem ≥1 PAO em T6, T7 ou T8. */
export function listPaoCoverageGaps(ctx: ScheduleContext): PaoCoverageGap[] {
  const gaps: PaoCoverageGap[] = [];
  const roleMap = buildRoleMap(ctx);

  for (const day of iterDays(ctx.year, ctx.month)) {
    for (const shiftCode of PAO_COVERAGE_SHIFTS) {
      const hasPao = ctx.assignments.some(
        (a) =>
          a.workDate === day &&
          !isInstructionShiftCode(a.shiftCode) &&
          baseShiftCode(a.shiftCode) === shiftCode &&
          roleMap.get(a.employeeId) === "PAO",
      );
      if (!hasPao) {
        gaps.push({ date: day, shiftCode });
      }
    }
  }
  return gaps;
}

export function countPaoCoverageGaps(ctx: ScheduleContext): number {
  return listPaoCoverageGaps(ctx).length;
}

export function coverageHealth(ctx: ScheduleContext): {
  ok: boolean;
  gaps: number;
  message: string;
} {
  const gaps = countPaoCoverageGaps(ctx);
  if (gaps === 0) {
    return { ok: true, gaps: 0, message: "Cobertura PAO T6/T7/T8: 100%." };
  }
  return {
    ok: false,
    gaps,
    message: `${gaps} furo(s) de cobertura PAO (T6/T7/T8).`,
  };
}

/** Verifica se cada APAO escalado no mês tem PAO cobrindo a janela (P-002). */
export function listApaoWithoutPaoCompanion(
  ctx: ScheduleContext,
  planned?: PlannedMap,
): { date: string; employeeName: string; shiftCode: string }[] {
  const shiftMap = buildShiftMapFromContext(ctx);
  const roleMap = buildRoleMap(ctx);
  const plan = planned ?? buildPlannedMap(ctx);
  const missing: { date: string; employeeName: string; shiftCode: string }[] = [];

  for (const a of ctx.assignments) {
    if (!isInMonth(a.workDate, ctx.year, ctx.month)) continue;
    if (roleMap.get(a.employeeId) !== "APAO") continue;
    if (roleForShift(a.shiftCode, shiftMap) !== "APAO") continue;

    const info = shiftMap[a.shiftCode];
    if (!info) continue;

    const { start, end } = shiftStartEnd(a.workDate, info.startTime, info.endTime);
    if (!intervalCoveredByPao(start, end, plan, shiftMap, roleMap)) {
      missing.push({
        date: a.workDate,
        employeeName: a.employeeName,
        shiftCode: a.shiftCode,
      });
    }
  }
  return missing;
}
