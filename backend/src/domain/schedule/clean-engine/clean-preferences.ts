import { assignmentKey } from "../types.js";
import { addDays } from "../../rules/dates.js";
import { isRateioTurnCode } from "./clean-types.js";
import { motorRuleEnabled, motorShiftAgrupamento, motorShiftEspacamento, motorShiftRuleEnabled } from "./clean-motor-rules.js";
import { findLastT8BlockEndDate } from "./clean-t8-blocks.js";
import { MIN_RATEIO_BLOCK_SIZE, minimumBlockSizeForShift } from "./clean-block-rules.js";
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

export function getTurnAgrupamentoDays(ws: CleanWorkspace, shiftCode: string): number {
  if (!motorShiftRuleEnabled(ws.options, "pao_espacamento_turnos", shiftCode)) return 1;
  return motorShiftAgrupamento(ws.options, shiftCode, 1);
}

function blockDatesFromStart(ws: CleanWorkspace, startDate: string, blockSize: number): string[] | null {
  const startIdx = ws.days.indexOf(startDate);
  if (startIdx < 0) return null;
  const dates: string[] = [];
  for (let i = 0; i < blockSize; i++) {
    const idx = startIdx + i;
    if (idx >= ws.days.length) return null;
    dates.push(ws.days[idx]!);
  }
  return dates;
}

function canPlacePreferredBlockDay(
  ws: CleanWorkspace,
  emp: (typeof ws.paoEmployees)[number],
  pref: string,
  date: string,
  isFirstDayOfBlock: boolean,
  spacingDays: number,
): boolean {
  if (ws.isEmployeeDayOccupied(emp.domainId, date)) return false;

  if (
    isFirstDayOfBlock &&
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

/** Tenta alocar bloco consecutivo de turnos preferidos; retorna quantos dias foram alocados. */
export function tryPlacePreferredBlock(
  ws: CleanWorkspace,
  emp: (typeof ws.paoEmployees)[number],
  pref: string,
  startDate: string,
  blockSize: number,
  spacingDays: number,
  phase: string,
  minBlockSize = minimumBlockSizeForShift(pref),
): number {
  if (blockSize <= 0) return 0;
  const floor = Math.max(1, minBlockSize);
  if (blockSize < floor) return 0;

  for (let size = blockSize; size >= floor; size--) {
    const blockDates = blockDatesFromStart(ws, startDate, size);
    if (!blockDates) continue;

    let canPlaceAll = true;
    for (let i = 0; i < blockDates.length; i++) {
      if (!canPlacePreferredBlockDay(ws, emp, pref, blockDates[i]!, i === 0, spacingDays)) {
        canPlaceAll = false;
        break;
      }
    }
    if (!canPlaceAll) continue;

    let placed = 0;
    for (const date of blockDates) {
      if (!ws.tryAssign(emp.uuid, date, pref, phase)) return placed;
      placed++;
    }
    return placed;
  }
  return 0;
}

/**
 * Cobertura T6/T7: tenta fechar furo com bloco consecutivo (mín. 3 dias) antes de turno isolado.
 */
export function tryFillCoverageBlock(
  ws: CleanWorkspace,
  gapDate: string,
  shiftCode: string,
  phase: string,
  candidates: (typeof ws.paoEmployees)[number][],
): boolean {
  const minSize = minimumBlockSizeForShift(shiftCode);
  if (minSize < MIN_RATEIO_BLOCK_SIZE) return false;

  const gapIdx = ws.days.indexOf(gapDate);
  if (gapIdx < 0) return false;

  const spacingDays = getTurnSpacingDays(ws, shiftCode);

  for (let offset = 0; offset >= -(minSize - 1); offset--) {
    const startIdx = gapIdx + offset;
    if (startIdx < 0) break;
    const startDate = ws.days[startIdx]!;
    const blockDates = blockDatesFromStart(ws, startDate, minSize);
    if (!blockDates || !blockDates.includes(gapDate)) continue;
    if (!blockDates.every((d) => !ws.hasPaoCoverage(d, shiftCode))) continue;

    for (const emp of candidates) {
      if (
        motorShiftRuleEnabled(ws.options, "pao_espacamento_turnos", shiftCode) &&
        prefersRateioShift(ws, emp.domainId, shiftCode) &&
        isBlockedOnlyByTurnSpacing(ws, emp.domainId, startDate, shiftCode)
      ) {
        continue;
      }
      const placed = tryPlacePreferredBlock(
        ws,
        emp,
        shiftCode,
        startDate,
        minSize,
        spacingDays,
        phase,
        minSize,
      );
      if (placed >= minSize) {
        ws.audit.record("COVERAGE_ASSIGNED", phase, `bloco ${minSize} dias`, {
          date: gapDate,
          shiftCode: shiftCode.toUpperCase(),
          employeeUuid: emp.uuid,
          employeeName: emp.employee.name,
        });
        return true;
      }
    }
  }
  return false;
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
          ? ws.effectiveMetaTurnosForShift(emp.uuid, pref)
          : Number.POSITIVE_INFINITY;

      const currentCount = ws.countRateioTurnsForShift(emp.uuid, pref);
      if (currentCount >= target) continue;

      const totalLimit = applyMeta
        ? ws.effectiveTotalMetaForEmployee(emp.uuid)
        : Number.POSITIVE_INFINITY;
      const totalCount = ws.countRateioTurns(emp.uuid);
      if (totalCount >= totalLimit) continue;

      const diasLimit = applyMeta
        ? ws.effectiveDiasTrabalhadosForEmployee(emp.uuid)
        : Number.POSITIVE_INFINITY;
      const diasCount = ws.countProductiveWorkDays(emp.uuid);
      if (diasCount >= diasLimit) continue;

      const agrupamento = getTurnAgrupamentoDays(ws, pref);
      const blockSize = Math.min(
        agrupamento,
        target - currentCount,
        totalLimit - totalCount,
        diasLimit - diasCount,
      );
      if (blockSize <= 0) continue;
      const spacingDays = getTurnSpacingDays(ws, pref);

      const placed = tryPlacePreferredBlock(ws, emp, pref, date, blockSize, spacingDays, phase);
      if (placed > 0) return true;
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

  const employees = ws.sortEmployeesForPreferredFill(
    ws.paoEmployees.filter((e) => {
      const pref = primaryPreferredRateio(ws, e.domainId);
      return pref && pref !== "T8" && ws.isShiftAllowedForGeneration(pref);
    }),
  );

  const prefByUuid = new Map<string, string>();
  for (const emp of employees) {
    const pref = primaryPreferredRateio(ws, emp.domainId);
    if (!pref) continue;
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
        ? ws.effectiveMetaTurnosForShift(emp.uuid, pref)
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
