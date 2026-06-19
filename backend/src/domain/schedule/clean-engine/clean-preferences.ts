import { assignmentKey } from "../types.js";
import { addDays } from "../../rules/dates.js";
import { isRateioTurnCode } from "./clean-types.js";
import { motorRuleEnabled, motorShiftEspacamento, motorShiftMetaTurnos, motorShiftRuleEnabled } from "./clean-motor-rules.js";
import { findLastT8BlockEndDate } from "./clean-t8-blocks.js";
import type { CleanWorkspace } from "./clean-workspace.js";
const RATEIO_PREF_ORDER = ["T8", "T6", "T7", "T9"] as const;

export function primaryPreferredRateio(
  ws: CleanWorkspace,
  domainId: number,
): string | null {
  const prefs = ws.input.preferredShifts?.get(domainId);
  if (!prefs || prefs.size === 0) return null;
  for (const code of RATEIO_PREF_ORDER) {
    if (prefs.has(code)) return code;
  }
  return [...prefs][0] ?? null;
}

export function employeePrefersShift(
  ws: CleanWorkspace,
  domainId: number,
  shiftCode: string,
): boolean {
  const prefs = ws.input.preferredShifts?.get(domainId);
  return prefs?.has(shiftCode.toUpperCase()) ?? false;
}

function employeeCoversShiftOnDay(
  ws: CleanWorkspace,
  domainId: number,
  date: string,
  shiftCode: string,
): boolean {
  const code = ws.planned.get(assignmentKey(domainId, date));
  return code?.toUpperCase() === shiftCode.toUpperCase();
}

/** Dias livres (sem turno nem bloqueio) entre duas datas. */
export function freeBlankDaysBetween(
  ws: CleanWorkspace,
  domainId: number,
  days: string[],
  fromDate: string,
  toDate: string,
): number {
  const fromIdx = days.indexOf(fromDate);
  const toIdx = days.indexOf(toDate);
  if (fromIdx < 0 && toIdx < 0) {
    return countFreeBlankDaysBetweenDates(ws, domainId, fromDate, toDate);
  }
  if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) {
    if (fromDate < toDate) {
      return countFreeBlankDaysBetweenDates(ws, domainId, fromDate, toDate);
    }
    return 0;
  }
  let free = 0;
  for (let i = fromIdx + 1; i < toIdx; i++) {
    const day = days[i]!;
    if (!ws.isEmployeeDayOccupied(domainId, day)) free++;
  }
  return free;
}

function countFreeBlankDaysBetweenDates(
  ws: CleanWorkspace,
  domainId: number,
  fromDate: string,
  toDate: string,
): number {
  if (toDate <= fromDate) return 0;
  let free = 0;
  let cursor = addDays(fromDate, 1);
  while (cursor < toDate) {
    if (!ws.isEmployeeDayOccupied(domainId, cursor)) free++;
    cursor = addDays(cursor, 1);
  }
  return free;
}

export function getTurnSpacingDays(ws: CleanWorkspace, shiftCode: string): number {
  if (!motorShiftRuleEnabled(ws.options, "pao_espacamento_turnos", shiftCode)) return 0;
  return motorShiftEspacamento(ws.options, shiftCode, 0);
}

export function respectsTurnSpacingBefore(
  ws: CleanWorkspace,
  domainId: number,
  candidateDate: string,
  spacingDays: number,
  lastEndDate: string | null,
): boolean {
  if (spacingDays <= 0 || !lastEndDate) return true;
  return (
    freeBlankDaysBetween(ws, domainId, ws.days, lastEndDate, candidateDate) >= spacingDays
  );
}

/** Último dia de turno rateio (T6/T7/T8/T9) antes de candidateDate. */
export function findLastRateioTurnEndDate(
  ws: CleanWorkspace,
  domainId: number,
  beforeDate: string,
): string | null {
  let last: string | null = null;
  for (const day of ws.days) {
    if (day >= beforeDate) break;
    const shift = ws.getShiftOnDay(domainId, day);
    if (shift && isRateioTurnCode(shift)) last = day;
  }
  if (last) return last;

  for (const [key, code] of ws.mergedPlannedSnapshot()) {
    const [didStr, date] = key.split("|");
    if (Number(didStr) !== domainId || date >= beforeDate) continue;
    if (isRateioTurnCode(code)) {
      if (!last || date > last) last = date;
    }
  }
  return last;
}

/** Exportado para testes unitários do espaçamento. */
export function freeSpacingGapForTest(
  ws: CleanWorkspace,
  domainId: number,
  days: string[],
  fromDate: string,
  toDate: string,
): number {
  return freeBlankDaysBetween(ws, domainId, days, fromDate, toDate);
}

export function isT8PreferredPao(ws: CleanWorkspace, uuid: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;
  return primaryPreferredRateio(ws, did) === "T8";
}

/** PAO prefere este turno rateio (primário ou secundário). */
export function prefersRateioShift(ws: CleanWorkspace, domainId: number, shiftCode: string): boolean {
  return employeePrefersShift(ws, domainId, shiftCode);
}

/** Bloqueio apenas por espaçamento mínimo entre turnos iguais (demais regras ok). */
export function isBlockedOnlyByTurnSpacing(
  ws: CleanWorkspace,
  domainId: number,
  date: string,
  shiftCode: string,
): boolean {
  if (ws.isEmployeeDayOccupied(domainId, date)) return false;
  const spacingDays = getTurnSpacingDays(ws, shiftCode);
  if (spacingDays <= 0) return false;
  const normalized = shiftCode.toUpperCase();
  const lastEnd =
    normalized === "T8"
      ? findLastT8BlockEndDate(ws, domainId, date)
      : findLastRateioTurnEndDate(ws, domainId, date);
  return !respectsTurnSpacingBefore(ws, domainId, date, spacingDays, lastEnd);
}

function canPlacePreferredShiftOnDay(
  ws: CleanWorkspace,
  emp: (typeof ws.paoEmployees)[number],
  pref: string,
  date: string,
  spacingDays: number,
): boolean {
  if (ws.isEmployeeDayOccupied(emp.domainId, date)) return false;

  if (
    spacingDays > 0 &&
    !respectsTurnSpacingBefore(
      ws,
      emp.domainId,
      date,
      spacingDays,
      findLastRateioTurnEndDate(ws, emp.domainId, date),
    )
  ) {
    return false;
  }

  if (
    ws.hasPaoCoverage(date, pref) &&
    !employeeCoversShiftOnDay(ws, emp.domainId, date, pref)
  ) {
    return false;
  }

  return true;
}

function tryPlaceNextPreferredShiftByDayAndSeniority(
  ws: CleanWorkspace,
  employees: (typeof ws.paoEmployees),
  prefByUuid: Map<string, string>,
  applyMeta: boolean,
  phase: string,
): boolean {
  for (const date of ws.days) {
    for (const emp of employees) {
      const pref = prefByUuid.get(emp.uuid);
      if (!pref) continue;
      if (!ws.isShiftAllowedForGeneration(pref)) continue;

      const target =
        applyMeta && motorShiftRuleEnabled(ws.options, "pao_meta_turnos", pref)
          ? motorShiftMetaTurnos(ws.options, pref, 20)
          : Number.POSITIVE_INFINITY;

      if (ws.countRateioTurnsForShift(emp.uuid, pref) >= target) continue;

      const spacingDays = getTurnSpacingDays(ws, pref);
      if (!canPlacePreferredShiftOnDay(ws, emp, pref, date, spacingDays)) continue;
      if (ws.tryAssign(emp.uuid, date, pref, phase)) return true;
    }
  }
  return false;
}

/**
 * Aloca turno preferido (T6/T7/T9) por calendário + antiguidade:
 * no dia mais cedo possível, tenta o PAO mais antigo; se não couber, passa ao próximo.
 */
export function fillPreferredShifts(ws: CleanWorkspace): void {
  if (!motorRuleEnabled(ws.options, "preferred_shifts")) return;

  const phase = "PREFERRED";
  const applyMeta = motorRuleEnabled(ws.options, "pao_meta_turnos");

  const employees = [...ws.paoEmployees].sort(
    (a, b) =>
      a.employee.seniority - b.employee.seniority ||
      a.employee.name.localeCompare(b.employee.name),
  );

  const prefByUuid = new Map<string, string>();
  for (const emp of employees) {
    const pref = primaryPreferredRateio(ws, emp.domainId);
    if (!pref || pref === "T8") continue;
    if (!ws.isShiftAllowedForGeneration(pref)) continue;
    prefByUuid.set(emp.uuid, pref);
  }

  while (tryPlaceNextPreferredShiftByDayAndSeniority(ws, employees, prefByUuid, applyMeta, phase)) {
    // revarre dias 1..N pela ordem de antiguidade
  }

  for (const emp of employees) {
    const pref = prefByUuid.get(emp.uuid);
    if (!pref) continue;
    const target =
      applyMeta && motorShiftRuleEnabled(ws.options, "pao_meta_turnos", pref)
        ? motorShiftMetaTurnos(ws.options, pref, 20)
        : Number.POSITIVE_INFINITY;
    if (ws.countRateioTurnsForShift(emp.uuid, pref) >= target) {
      ws.audit.record("PREFERRED_META_REACHED", phase, `meta ${target} turno(s)`, {
        shiftCode: pref,
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      });
    }
  }
}

export function compareCandidatesForShift(
  ws: CleanWorkspace,
  shiftCode: string,
  aDomainId: number,
  bDomainId: number,
  aUuid: string,
  bUuid: string,
): number {
  const normalized = shiftCode.toUpperCase();
  if (!motorRuleEnabled(ws.options, "preferred_shifts")) return 0;

  const aMatch = employeePrefersShift(ws, aDomainId, normalized);
  const bMatch = employeePrefersShift(ws, bDomainId, normalized);
  if (aMatch !== bMatch) return aMatch ? -1 : 1;

  const aPrimary = primaryPreferredRateio(ws, aDomainId);
  const bPrimary = primaryPreferredRateio(ws, bDomainId);
  const aMismatch = Boolean(aPrimary && aPrimary !== normalized);
  const bMismatch = Boolean(bPrimary && bPrimary !== normalized);
  if (aMismatch !== bMismatch) return aMismatch ? 1 : -1;

  const ta = ws.countRateioTurnsForShift(aUuid, normalized);
  const tb = ws.countRateioTurnsForShift(bUuid, normalized);
  if (ta !== tb) return ta - tb;

  return 0;
}

export function isRateioShiftCode(code: string): boolean {
  return isRateioTurnCode(code);
}
