import { MIN_SHIFTS_FULL_NO_FLIGHT_MONTH } from "../employee/restrictions.js";
import { VACATION_TYPES } from "../rules/constants.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { countAllocatedTurns } from "./real-schedule-turn-rateio.js";

/** 0 = mês inteiro sem voo; 1 = férias no mês; 2 = demais PAOs. */
export type PaoPriorityTier = 0 | 1 | 2;

export function hasVacationInMonth(ws: GenerationWorkspace, uuid: string): boolean {
  return ws.input.vacationDays.some((v) => v.employeeUuid === uuid);
}

export function getPaoPriorityTier(ws: GenerationWorkspace, uuid: string): PaoPriorityTier {
  if (ws.isFullMonthNoFlight(uuid)) return 0;
  if (hasVacationInMonth(ws, uuid)) return 1;
  return 2;
}

export function vacationDaysForPao(ws: GenerationWorkspace, uuid: string): string[] {
  return ws.input.vacationDays
    .filter((v) => v.employeeUuid === uuid)
    .map((v) => v.date)
    .sort((a, b) => ws.days.indexOf(a) - ws.days.indexOf(b));
}

export function isVacationDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const label = ws.blocked.get(`${did}|${day}`);
  if (!label) return false;
  const upper = label.toUpperCase();
  return VACATION_TYPES.has(upper) || upper === "FÉRIAS";
}

function tierSortKey(ws: GenerationWorkspace, uuid: string, tier: PaoPriorityTier): number {
  if (tier === 0) {
    const deficit = MIN_SHIFTS_FULL_NO_FLIGHT_MONTH - countAllocatedTurns(ws, uuid);
    return deficit > 0 ? deficit : 0;
  }
  if (tier === 1) {
    return MIN_SHIFTS_FULL_NO_FLIGHT_MONTH - ws.workCount(uuid);
  }
  return 0;
}

/** Ordena PAOs: mês sem voo → férias → senioridade crescente; desempate por carga. */
export function comparePaoOperationalPriority(
  ws: GenerationWorkspace,
  a: GenerationInputEmployee,
  b: GenerationInputEmployee,
  dayIndex: number,
): number {
  const tierA = getPaoPriorityTier(ws, a.uuid);
  const tierB = getPaoPriorityTier(ws, b.uuid);
  if (tierA !== tierB) return tierA - tierB;

  const keyA = tierSortKey(ws, a.uuid, tierA);
  const keyB = tierSortKey(ws, b.uuid, tierB);
  if (keyA !== keyB) return keyB - keyA;

  const workDiff = ws.workCount(a.uuid) - ws.workCount(b.uuid);
  if (workDiff !== 0) return workDiff;

  if (tierA === 2) {
    const sen = a.employee.seniority - b.employee.seniority;
    if (sen !== 0) return sen;
  }

  return (
    ((a.domainId + dayIndex) % ws.paoEmps.length) -
    ((b.domainId + dayIndex) % ws.paoEmps.length)
  );
}

export function sortPaoByOperationalPriority(
  ws: GenerationWorkspace,
  dayIndex: number,
): GenerationInputEmployee[] {
  return [...ws.paoEmps].sort((a, b) => comparePaoOperationalPriority(ws, a, b, dayIndex));
}
