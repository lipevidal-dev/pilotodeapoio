import { addDays } from "../../rules/dates.js";
import { has12hRest } from "../../rules/time.js";
import { assignmentKey } from "../types.js";
import { CROSS_MONTH_ND_LABEL } from "../operational-labels.js";
import type { GeneratedAllocation } from "../generation-types.js";
import type { CleanWorkspace } from "./clean-workspace.js";
import {
  employeeCanStartT8Block,
  findLastT8BlockEndDate,
  isDayBlockedForShift,
  wouldExceedMetaTurnos,
} from "./clean-t8-blocks.js";
import { getTurnSpacingDays, isT8PreferredPao, respectsTurnSpacingBefore } from "./clean-preferences.js";

const PHASE = "T8_CROSS_MONTH";

export function isLastDayOfMonth(ws: CleanWorkspace, day: string): boolean {
  const last = ws.days[ws.days.length - 1];
  return last === day;
}

export function isDateBeyondCurrentMonth(ws: CleanWorkspace, date: string): boolean {
  const last = ws.days[ws.days.length - 1];
  return last != null && date > last;
}

export function isNextMonthDayFreeForNd(
  ws: CleanWorkspace,
  uuid: string,
  date: string,
): boolean {
  return nextMonthDayFree(ws, uuid, date);
}

function nextMonthDayFree(ws: CleanWorkspace, uuid: string, date: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;
  if (ws.getCrossMonthShiftOnDay(did, date)) return false;
  const block = ws.getCrossMonthBlockLabel(did, date);
  if (!block) return true;
  const upper = block.toUpperCase();
  if (upper === "ND" || upper === CROSS_MONTH_ND_LABEL.toUpperCase()) return true;
  if (upper === "FOLGA PEDIDA" || upper === "FOLGA SOCIAL" || upper === "FOLGA") return true;
  return false;
}

function otherPaoHasCrossMonthT8(ws: CleanWorkspace, date: string, excludeUuid: string): boolean {
  for (const row of ws.crossMonthPreAllocations) {
    if (row.date !== date || row.label.toUpperCase() !== "T8") continue;
    if (row.employeeUuid === excludeUuid) continue;
    const role = ws.roleByDomain.get(ws.uuidToDomain.get(row.employeeUuid) ?? -1);
    if (role && ws.paoEmployees.some((p) => p.uuid === row.employeeUuid)) return true;
  }
  return false;
}

/** Bloco T8/T8/ND com 1º T8 no último dia do mês e continuação fixa no mês seguinte. */
export function canPlaceT8BlockCrossMonthEnd(
  ws: CleanWorkspace,
  uuid: string,
  startDay: string,
  coverageEmergency = false,
  ignoreSpacing = false,
): boolean {
  if (!isLastDayOfMonth(ws, startDay)) return false;
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;

  const d0 = startDay;
  const d1 = addDays(d0, 1);
  const d2 = addDays(d0, 2);

  if (ws.getShiftOnDay(did, d0)?.toUpperCase() === "T8") return false;
  if (isDayBlockedForShift(ws, uuid, d0)) return false;
  if (!employeeCanStartT8Block(ws, uuid, coverageEmergency, ignoreSpacing)) return false;
  if (ws.isPaoRateioShiftTakenByOther(uuid, d0, "T8")) return false;
  if (otherPaoHasCrossMonthT8(ws, d1, uuid)) return false;
  if (!nextMonthDayFree(ws, uuid, d1) || !nextMonthDayFree(ws, uuid, d2)) return false;
  if (wouldExceedMetaTurnos(ws, uuid, 2)) return false;

  const spacingDays = getTurnSpacingDays(ws, "T8");
  if (
    !ignoreSpacing &&
    spacingDays > 0 &&
    (!coverageEmergency || isT8PreferredPao(ws, uuid))
  ) {
    const lastBlockEnd = findLastT8BlockEndDate(ws, did, startDay);
    if (!respectsTurnSpacingBefore(ws, did, startDay, spacingDays, lastBlockEnd)) {
      return false;
    }
  }

  const continuity = ws.mergedPlannedSnapshot();
  const r0 = ws.checkCanWork(uuid, d0, "T8", continuity);
  if (!r0.ok) return false;
  const rest0 = has12hRest(did, d0, "T8", continuity, ws.shiftMap);
  if (!rest0.ok) return false;

  const withFirst = new Map(continuity);
  withFirst.set(assignmentKey(did, d0), "T8");
  const r1 = ws.checkCanWork(uuid, d1, "T8", withFirst);
  if (!r1.ok) return false;
  const rest1 = has12hRest(did, d1, "T8", withFirst, ws.shiftMap);
  if (!rest1.ok) return false;

  return true;
}

export function tryPlaceT8BlockCrossMonthEnd(
  ws: CleanWorkspace,
  uuid: string,
  startDay: string,
  coverageEmergency = false,
  ignoreSpacing = false,
): boolean {
  if (!canPlaceT8BlockCrossMonthEnd(ws, uuid, startDay, coverageEmergency, ignoreSpacing)) {
    return false;
  }

  const d0 = startDay;
  const d1 = addDays(d0, 1);
  const d2 = addDays(d0, 2);
  if (!ws.tryAssign(uuid, d0, "T8", PHASE)) return false;

  const nextMonthRows: GeneratedAllocation[] = [
    { employeeUuid: uuid, date: d1, label: "T8" },
    { employeeUuid: uuid, date: d2, label: CROSS_MONTH_ND_LABEL },
  ];
  ws.addCrossMonthPreAllocations(nextMonthRows);

  ws.audit.record(
    "COVERAGE_ASSIGNED",
    PHASE,
    "bloco T8/T8/ND — T8 no fim do mês + continuidade fixa no mês seguinte",
    {
      date: d0,
      shiftCode: "T8",
      employeeUuid: uuid,
      employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
    },
  );
  return true;
}
