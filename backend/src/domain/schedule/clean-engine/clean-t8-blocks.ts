import { addDays } from "../../rules/dates.js";
import { has12hRest } from "../../rules/time.js";
import { normalizeOperationalLabel, isOperationalHardBlock } from "../operational-labels.js";
import { assignmentKey, type PlannedMap } from "../types.js";
import { motorRuleEnabled, motorShiftMetaTurnos, motorShiftRuleEnabled } from "./clean-motor-rules.js";
import {
  getTurnSpacingDays,
  isT8PreferredPao,
  respectsTurnSpacingBefore,
} from "./clean-preferences.js";
import type { GenerationInputEmployee } from "../generation-types.js";
import type { CleanWorkspace } from "./clean-workspace.js";
import {
  canPlaceT8BlockCrossMonthEnd,
  isDateBeyondCurrentMonth,
  isLastDayOfMonth,
  isNextMonthDayFreeForNd,
  tryPlaceT8BlockCrossMonthEnd,
} from "./clean-cross-month-t8.js";
import { CROSS_MONTH_ND_LABEL } from "../operational-labels.js";

/** Teto operacional absoluto de blocos T8/T8/ND por PAO no mês. */
export const MAX_T8_BLOCKS_PER_PAO_MONTH = 15;

const PHASE = "T8_BLOCK";

export function sortPaoBySeniorityOldestFirst<T extends GenerationInputEmployee>(employees: T[]): T[] {
  return [...employees].sort(
    (a, b) =>
      a.employee.seniority - b.employee.seniority ||
      a.employee.name.localeCompare(b.employee.name),
  );
}

export function sortPaoBySeniorityNewestFirst<T extends GenerationInputEmployee>(employees: T[]): T[] {
  return [...employees].sort(
    (a, b) =>
      b.employee.seniority - a.employee.seniority ||
      a.employee.name.localeCompare(b.employee.name),
  );
}

function sortPaoBySeniority<T extends GenerationInputEmployee>(employees: T[]): T[] {
  return sortPaoBySeniorityOldestFirst(employees);
}

export function countT8Blocks(ws: CleanWorkspace, uuid: string): number {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return 0;

  let blocks = 0;
  const seen = new Set<string>();
  for (const day of ws.days) {
    const token = `${uuid}|${day}`;
    if (seen.has(token)) continue;
    if (ws.getShiftOnDay(did, day)?.toUpperCase() !== "T8") continue;
    const next = addDays(day, 1);
    if (ws.getShiftOnDay(did, next)?.toUpperCase() === "T8") {
      blocks++;
      seen.add(token);
      seen.add(`${uuid}|${next}`);
    }
  }
  return blocks;
}

function maxT8BlocksForEmployee(ws: CleanWorkspace): number {
  if (!motorShiftRuleEnabled(ws.options, "pao_meta_turnos", "T8")) {
    return MAX_T8_BLOCKS_PER_PAO_MONTH;
  }
  const meta = motorShiftMetaTurnos(ws.options, "T8", 20);
  return Math.min(MAX_T8_BLOCKS_PER_PAO_MONTH, Math.floor(meta / 2));
}

function employeeAtT8BlockLimit(ws: CleanWorkspace, uuid: string): boolean {
  return countT8Blocks(ws, uuid) >= maxT8BlocksForEmployee(ws);
}

function anyOtherPaoCanStartT8Block(ws: CleanWorkspace, excludeUuid: string): boolean {
  for (const c of ws.paoEmployees) {
    if (c.uuid === excludeUuid) continue;
    if (!employeeAtT8BlockLimit(ws, c.uuid)) return true;
  }
  return false;
}

export function employeeCanStartT8Block(
  ws: CleanWorkspace,
  uuid: string,
  coverageEmergency = false,
  ignoreSpacing = false,
): boolean {
  if (!employeeAtT8BlockLimit(ws, uuid)) return true;
  if (!coverageEmergency) return false;
  if (ignoreSpacing) return true;
  return !anyOtherPaoCanStartT8Block(ws, uuid);
}

export function isDayBlockedForShift(ws: CleanWorkspace, uuid: string, date: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return true;
  const label = ws.getBlockLabel(did, date);
  if (!label) return false;
  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (upper === "FÉRIAS" || upper === "FOLGA PEDIDA") return true;
  return isOperationalHardBlock(label);
}

function ndDayFree(ws: CleanWorkspace, uuid: string, ndDate: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;

  if (ws.getShiftOnDay(did, ndDate)) return false;

  const block = ws.getBlockLabel(did, ndDate);
  if (!block) return true;

  const upper = normalizeOperationalLabel(block).toUpperCase();
  if (upper === "ND") return true;
  if (upper === "FOLGA PEDIDA" || upper === "FOLGA SOCIAL" || upper === "FOLGA") return true;
  return !isOperationalHardBlock(block);
}

export function wouldExceedMetaTurnos(
  ws: CleanWorkspace,
  uuid: string,
  extraTurnos: number,
  extraNd = 0,
): boolean {
  if (motorShiftRuleEnabled(ws.options, "pao_meta_turnos", "T8")) {
    const meta = ws.effectiveMetaTurnosForShift(uuid, "T8");
    if (ws.countRateioTurnsForShift(uuid, "T8") + extraTurnos > meta) return true;
  }
  return ws.wouldExceedPaoCapacity(uuid, extraTurnos, extraTurnos + extraNd);
}

function evaluateCanWork(
  ws: CleanWorkspace,
  uuid: string,
  date: string,
  shiftCode: string,
  planned: PlannedMap,
): { ok: boolean; reason: string } {
  return ws.checkCanWork(uuid, date, shiftCode, planned);
}

export function canPlaceT8Block(
  ws: CleanWorkspace,
  uuid: string,
  startDay: string,
  coverageEmergency = false,
  ignoreSpacing = false,
): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null || !ws.days.includes(startDay)) return false;

  const d0 = startDay;
  const d1 = addDays(d0, 1);
  const d2 = addDays(d0, 2);
  if (!ws.days.includes(d1)) return false;

  const existing0 = ws.getShiftOnDay(did, d0)?.toUpperCase();
  const existing1 = ws.getShiftOnDay(did, d1)?.toUpperCase();

  const lastDay = ws.days[ws.days.length - 1];
  if (
    lastDay &&
    d1 === lastDay &&
    existing0 !== "T8" &&
    existing1 !== "T8"
  ) {
    return false;
  }

  if (
    existing0 !== "T8" &&
    existing1 !== "T8" &&
    !employeeCanStartT8Block(ws, uuid, coverageEmergency, ignoreSpacing)
  ) {
    return false;
  }

  for (const d of [d0, d1]) {
    if (isDayBlockedForShift(ws, uuid, d)) return false;
  }

  if (existing0 !== "T8" && ws.isPaoRateioShiftTakenByOther(uuid, d0, "T8")) return false;
  if (existing1 !== "T8" && ws.isPaoRateioShiftTakenByOther(uuid, d1, "T8")) return false;

  if (ws.days.includes(d2)) {
    if (!ndDayFree(ws, uuid, d2)) return false;
  } else if (isDateBeyondCurrentMonth(ws, d2) && !isNextMonthDayFreeForNd(ws, uuid, d2)) {
    return false;
  }

  if (existing0 && existing0 !== "T8") return false;
  if (existing1 && existing1 !== "T8") return false;
  if (existing0 === "T8" && existing1 === "T8") return false;
  if (existing0 === "T8" && ws.getShiftOnDay(did, addDays(d0, -1))?.toUpperCase() === "T8") {
    return false;
  }

  const newTurnos =
    (existing0 === "T8" ? 0 : 1) + (existing1 === "T8" ? 0 : 1);
  let newNd = 0;
  if (ws.days.includes(d2) && ndDayFree(ws, uuid, d2)) {
    newNd = 1;
  } else if (isDateBeyondCurrentMonth(ws, d2) && isNextMonthDayFreeForNd(ws, uuid, d2)) {
    newNd = 0;
  }
  if (wouldExceedMetaTurnos(ws, uuid, newTurnos, newNd)) return false;

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

  if (existing0 !== "T8") {
    const r0 = evaluateCanWork(ws, uuid, d0, "T8", continuity);
    if (!r0.ok) return false;
    const rest0 = has12hRest(did, d0, "T8", continuity, ws.shiftMap);
    if (!rest0.ok) return false;
  }

  const withFirst = new Map(continuity);
  withFirst.set(assignmentKey(did, d0), "T8");
  if (existing1 !== "T8") {
    const r1 = evaluateCanWork(ws, uuid, d1, "T8", withFirst);
    if (!r1.ok) return false;
    const rest1 = has12hRest(did, d1, "T8", withFirst, ws.shiftMap);
    if (!rest1.ok) return false;
  }

  return true;
}

/** Último dia do bloco T8/T8/ND (preferência: ND) antes de candidateStart. */
export function findLastT8BlockEndDate(
  ws: CleanWorkspace,
  domainId: number,
  beforeDate: string,
): string | null {
  let lastEnd: string | null = null;

  for (let i = 1; i < ws.days.length; i++) {
    const day = ws.days[i]!;
    if (day >= beforeDate) break;
    const prev = ws.days[i - 1]!;
    if (
      ws.getShiftOnDay(domainId, day)?.toUpperCase() === "T8" &&
      ws.getShiftOnDay(domainId, prev)?.toUpperCase() === "T8"
    ) {
      lastEnd = addDays(day, 1);
    }
  }

  return lastEnd;
}

function applyNdForBlock(ws: CleanWorkspace, uuid: string, ndDate: string): void {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return;

  if (isDateBeyondCurrentMonth(ws, ndDate)) {
    ws.addCrossMonthPreAllocations([
      { employeeUuid: uuid, date: ndDate, label: CROSS_MONTH_ND_LABEL },
    ]);
    ws.audit.record("T8_ND_APPLIED", PHASE, "ND CONTINUIDADE pré-alocado no mês seguinte", {
      date: ndDate,
      employeeUuid: uuid,
      employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
    });
    return;
  }

  const ndKey = assignmentKey(did, ndDate);
  const existingShift = ws.planned.get(ndKey);
  if (existingShift && !ws.isLockedRateioDay(uuid, ndDate)) {
    ws.unassignPlannedDay(did, ndDate);
    ws.audit.record("T8_ND_REQUIRED", PHASE, `remove ${existingShift} — ND do bloco T8/T8`, {
      date: ndDate,
      employeeUuid: uuid,
      employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
    });
  }

  const existingBlock = ws.getBlockLabel(did, ndDate);
  if (existingBlock) {
    ws.clearBlock(did, ndDate);
    ws.audit.record("T8_ND_REQUIRED", PHASE, `remove bloqueio ${existingBlock} — ND do bloco`, {
      date: ndDate,
      employeeUuid: uuid,
      employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
    });
  }

  ws.setBlockDay(uuid, ndDate, "ND");
  ws.audit.record("T8_ND_APPLIED", PHASE, "ND alocado no bloco T8/T8/ND", {
    date: ndDate,
    employeeUuid: uuid,
    employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
  });
}

/** Aloca bloco indivisível T8/T8/ND a partir de startDay. */
export function tryPlaceT8Block(
  ws: CleanWorkspace,
  uuid: string,
  startDay: string,
  coverageEmergency = false,
  ignoreSpacing = false,
): boolean {
  if (!canPlaceT8Block(ws, uuid, startDay, coverageEmergency, ignoreSpacing)) return false;

  const did = ws.uuidToDomain.get(uuid)!;
  const d0 = startDay;
  const d1 = addDays(d0, 1);
  const d2 = addDays(d0, 2);

  if (ws.getShiftOnDay(did, d0)?.toUpperCase() !== "T8" && !ws.tryAssign(uuid, d0, "T8", PHASE)) {
    return false;
  }
  if (ws.getShiftOnDay(did, d1)?.toUpperCase() !== "T8" && !ws.tryAssign(uuid, d1, "T8", PHASE)) {
    if (ws.getShiftOnDay(did, d0)?.toUpperCase() === "T8" && !ws.isLockedRateioDay(uuid, d0)) {
      ws.unassignPlannedDay(did, d0);
    }
    return false;
  }

  applyNdForBlock(ws, uuid, d2);
  const spacingOverride = ignoreSpacing && getTurnSpacingDays(ws, "T8") > 0;
  ws.audit.record(
    "COVERAGE_ASSIGNED",
    PHASE,
    spacingOverride
      ? "bloco T8/T8/ND alocado (exceção de espaçamento na cobertura)"
      : "bloco T8/T8/ND alocado",
    {
      date: d0,
      shiftCode: "T8",
      employeeUuid: uuid,
      employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
    },
  );
  return true;
}

/** Completa par T8/T8 quando o primeiro dia já é T8. */
export function tryCompleteT8Pair(
  ws: CleanWorkspace,
  uuid: string,
  secondDay: string,
  coverageEmergency = false,
  ignoreSpacing = false,
): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null || !ws.days.includes(secondDay)) return false;

  const firstDay = addDays(secondDay, -1);
  if (ws.getShiftOnDay(did, firstDay)?.toUpperCase() !== "T8") return false;
  if (ws.getShiftOnDay(did, addDays(firstDay, -1))?.toUpperCase() === "T8") return false;
  if (ws.getShiftOnDay(did, secondDay)?.toUpperCase() === "T8") return false;
  if (isDayBlockedForShift(ws, uuid, secondDay)) return false;

  const ndDay = addDays(secondDay, 1);
  if (ws.days.includes(ndDay) && !ndDayFree(ws, uuid, ndDay)) return false;
  if (
    !ws.days.includes(ndDay) &&
    isDateBeyondCurrentMonth(ws, ndDay) &&
    !isNextMonthDayFreeForNd(ws, uuid, ndDay)
  ) {
    return false;
  }

  if (!canPlaceT8Block(ws, uuid, firstDay, coverageEmergency, ignoreSpacing)) return false;
  if (!ws.tryAssign(uuid, secondDay, "T8", PHASE)) return false;

  applyNdForBlock(ws, uuid, ndDay);
  if (ignoreSpacing && getTurnSpacingDays(ws, "T8") > 0) {
    ws.audit.record(
      "COVERAGE_ASSIGNED",
      PHASE,
      "par T8/T8 completado na cobertura (exceção de espaçamento)",
      {
        date: secondDay,
        shiftCode: "T8",
        employeeUuid: uuid,
        employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
      },
    );
  }
  return true;
}

function employeeT8BlockStartsAt(ws: CleanWorkspace, uuid: string, startDay: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null || !ws.days.includes(startDay)) return false;
  const d1 = addDays(startDay, 1);
  if (!ws.days.includes(d1)) return false;
  if (ws.getShiftOnDay(did, startDay)?.toUpperCase() !== "T8") return false;
  if (ws.getShiftOnDay(did, d1)?.toUpperCase() !== "T8") return false;
  const prev = addDays(startDay, -1);
  if (ws.days.includes(prev) && ws.getShiftOnDay(did, prev)?.toUpperCase() === "T8") {
    return false;
  }
  return true;
}

function unassignEmployeeT8Block(ws: CleanWorkspace, uuid: string, startDay: string): void {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return;
  const d0 = startDay;
  const d1 = addDays(d0, 1);
  const d2 = addDays(d0, 2);
  for (const d of [d0, d1]) {
    if (ws.getShiftOnDay(did, d)?.toUpperCase() === "T8" && !ws.isLockedRateioDay(uuid, d)) {
      ws.unassignPlannedDay(did, d);
    }
  }
  if (ws.days.includes(d2)) {
    const nd = ws.getBlockLabel(did, d2);
    if (nd?.toUpperCase() === "ND") {
      ws.clearBlock(did, d2);
    }
  }
}

function t8BlockDaysUnlocked(ws: CleanWorkspace, uuid: string, startDay: string): boolean {
  for (const d of [startDay, addDays(startDay, 1), addDays(startDay, 2)]) {
    if (ws.isLockedRateioDay(uuid, d)) return false;
  }
  return true;
}

/** Cobertura: desloca bloco T8/T8/ND que começa no dia seguinte ao furo. */
function tryPlaceT8BlockForCoverage(
  ws: CleanWorkspace,
  uuid: string,
  startDay: string,
  ignoreSpacing: boolean,
): boolean {
  if (tryPlaceT8Block(ws, uuid, startDay, true, ignoreSpacing)) return true;

  const conflictStart = addDays(startDay, 1);
  if (!employeeT8BlockStartsAt(ws, uuid, conflictStart)) return false;
  if (!t8BlockDaysUnlocked(ws, uuid, conflictStart)) return false;

  unassignEmployeeT8Block(ws, uuid, conflictStart);
  if (tryPlaceT8Block(ws, uuid, startDay, true, ignoreSpacing)) {
    ws.audit.record(
      "COVERAGE_ASSIGNED",
      "COVERAGE",
      "bloco T8/T8/ND realocado na cobertura (liberou bloco posterior)",
      {
        date: startDay,
        shiftCode: "T8",
        employeeUuid: uuid,
        employeeName: ws.input.employees.find((e) => e.uuid === uuid)?.employee.name,
      },
    );
    return true;
  }

  tryPlaceT8Block(ws, uuid, conflictStart, true, ignoreSpacing);
  return false;
}

function buildT8CoverageCandidatePool(
  ws: CleanWorkspace,
  gapDay: string,
): Array<(typeof ws.paoEmployees)[number]> {
  const applyMeta =
    ws.usesNextMotorRules() && motorShiftRuleEnabled(ws.options, "pao_meta_turnos", "T8");

  const eligible = ws.paoEmployees.filter((c) => {
    if (!applyMeta) return true;

    const t8Meta = ws.effectiveMetaTurnosForShift(c.uuid, "T8");
    const belowT8Meta = ws.countRateioTurnsForShift(c.uuid, "T8") < t8Meta;
    if (belowT8Meta) {
      return ws.hasTotalMetaHeadroom(c.uuid, 1) && ws.hasDiasTrabalhadosHeadroom(c.uuid, 1);
    }

    if (
      isLastDayOfMonth(ws, gapDay) &&
      canPlaceT8BlockCrossMonthEnd(ws, c.uuid, gapDay, true, true)
    ) {
      return true;
    }
    // No teto da meta T8: ainda pode fechar o furo realocando bloco que começa no dia seguinte.
    const conflictStart = addDays(gapDay, 1);
    if (!ws.days.includes(conflictStart)) return false;
    return (
      employeeT8BlockStartsAt(ws, c.uuid, conflictStart) &&
      t8BlockDaysUnlocked(ws, c.uuid, conflictStart)
    );
  });
  const t8Preferred = sortPaoBySeniorityOldestFirst(
    eligible.filter((c) => isT8PreferredPao(ws, c.uuid)),
  );
  const others = sortPaoBySeniorityNewestFirst(
    eligible.filter((c) => !isT8PreferredPao(ws, c.uuid)),
  );
  return [...t8Preferred, ...others];
}

/** PAO consegue fechar o furo com bloco indivisível T8/T8/ND (não T8 avulso). */
function employeeCanCoverT8GapWithBlock(
  ws: CleanWorkspace,
  uuid: string,
  gapDay: string,
  ignoreSpacing: boolean,
): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;

  const prev = addDays(gapDay, -1);
  if (
    ws.days.includes(prev) &&
    ws.getShiftOnDay(did, prev)?.toUpperCase() === "T8" &&
    ws.getShiftOnDay(did, addDays(prev, -1))?.toUpperCase() !== "T8" &&
    ws.getShiftOnDay(did, gapDay)?.toUpperCase() !== "T8" &&
    canPlaceT8Block(ws, uuid, prev, true, ignoreSpacing)
  ) {
    return true;
  }

  if (canPlaceT8Block(ws, uuid, gapDay, true, ignoreSpacing)) return true;

  if (
    isLastDayOfMonth(ws, gapDay) &&
    canPlaceT8BlockCrossMonthEnd(ws, uuid, gapDay, true, ignoreSpacing)
  ) {
    return true;
  }

  const conflictStart = addDays(gapDay, 1);
  if (
    employeeT8BlockStartsAt(ws, uuid, conflictStart) &&
    t8BlockDaysUnlocked(ws, uuid, conflictStart)
  ) {
    return true;
  }

  if (ws.days.includes(prev) && canPlaceT8Block(ws, uuid, prev, true, ignoreSpacing)) {
    return true;
  }

  return false;
}

function tryAssignT8CoverageGapInternal(
  ws: CleanWorkspace,
  day: string,
  ignoreSpacing: boolean,
): boolean {
  const pool = buildT8CoverageCandidatePool(ws, day).filter((c) =>
    employeeCanCoverT8GapWithBlock(ws, c.uuid, day, ignoreSpacing),
  );

  if (isLastDayOfMonth(ws, day)) {
    for (const c of pool) {
      if (tryPlaceT8BlockCrossMonthEnd(ws, c.uuid, day, true, ignoreSpacing)) return true;
    }
    return false;
  }

  for (const c of pool) {
    if (tryCompleteT8Pair(ws, c.uuid, day, true, ignoreSpacing)) return true;
  }
  for (const c of pool) {
    if (tryPlaceT8BlockForCoverage(ws, c.uuid, day, ignoreSpacing)) return true;
  }
  const prev = addDays(day, -1);
  if (ws.days.includes(prev)) {
    for (const c of pool) {
      if (tryPlaceT8BlockForCoverage(ws, c.uuid, prev, ignoreSpacing)) return true;
    }
  }
  return false;
}

export function isBlockedByT8SpacingOnly(
  ws: CleanWorkspace,
  uuid: string,
  startDay: string,
): boolean {
  return (
    !canPlaceT8Block(ws, uuid, startDay, true, false) &&
    canPlaceT8Block(ws, uuid, startDay, true, true)
  );
}

/** Cobertura T8 — bloco T8/T8/ND; 2ª passada ignora espaçamento. */
export function tryAssignT8CoverageGap(ws: CleanWorkspace, day: string): boolean {
  if (tryAssignT8CoverageGapInternal(ws, day, false)) return true;
  return tryAssignT8CoverageGapInternal(ws, day, true);
}

export function employeeCanReceiveMoreT8Blocks(ws: CleanWorkspace, uuid: string): boolean {
  if (
    motorShiftRuleEnabled(ws.options, "pao_meta_turnos", "T8") &&
    ws.countRateioTurnsForShift(uuid, "T8") >= ws.effectiveMetaTurnosForShift(uuid, "T8")
  ) {
    return false;
  }
  if (motorRuleEnabled(ws.options, "pao_meta_turnos") && ws.wouldExceedTotalMetaTurnos(uuid, 1)) {
    return false;
  }
  if (motorRuleEnabled(ws.options, "pao_meta_dias_trabalhados") && ws.wouldExceedDiasTrabalhados(uuid, 1)) {
    return false;
  }
  return !employeeAtT8BlockLimit(ws, uuid);
}

/**
 * Coloca 1 bloco T8/T8/ND na primeira combinação (dia de início × antiguidade) que couber:
 * varre dias 1..N e, em cada dia, PAOs do mais antigo ao mais novo.
 */
export function tryPlaceNextT8BlockByDayAndSeniority(
  ws: CleanWorkspace,
  employees: GenerationInputEmployee[],
): boolean {
  for (const startDay of ws.days) {
    for (const emp of employees) {
      if (!employeeCanReceiveMoreT8Blocks(ws, emp.uuid)) continue;
      if (tryPlaceT8Block(ws, emp.uuid, startDay)) return true;
    }
  }
  return false;
}

/** Coloca o bloco T8/T8/ND mais cedo possível para o PAO (varre dias 1..N). */
export function tryPlaceEarliestT8Block(ws: CleanWorkspace, uuid: string): boolean {
  for (const day of ws.days) {
    if (tryPlaceT8Block(ws, uuid, day)) return true;
  }
  return false;
}

/** Preenche blocos T8/T8/ND do PAO — varre dias 1..N em ordem até a meta. */
export function fillT8BlocksForEmployee(ws: CleanWorkspace, uuid: string): void {
  while (employeeCanReceiveMoreT8Blocks(ws, uuid)) {
    if (!tryPlaceEarliestT8Block(ws, uuid)) break;
  }
}

/** Garante bloco T8/T8/ND cruzando o fim do mês (31 → T8, 01/+1 T8, 02/+1 ND). */
export function trySeedMonthEndT8Block(ws: CleanWorkspace): boolean {
  const last = ws.days[ws.days.length - 1];
  if (!last || ws.hasPaoCoverage(last, "T8")) return false;

  const pool = [
    ...sortPaoBySeniorityOldestFirst(ws.paoEmployees.filter((c) => isT8PreferredPao(ws, c.uuid))),
    ...sortPaoBySeniorityNewestFirst(ws.paoEmployees.filter((c) => !isT8PreferredPao(ws, c.uuid))),
  ];
  for (const c of pool) {
    if (tryPlaceT8BlockCrossMonthEnd(ws, c.uuid, last, true)) return true;
  }
  return false;
}

/** Preenche furos de cobertura T8 somente com blocos T8/T8/ND. */
export function fillT8CoverageGaps(ws: CleanWorkspace): void {
  if (!ws.usesNextMotorRules()) return;
  if (!motorRuleEnabled(ws.options, "coverage_t8")) return;
  if (!ws.isShiftAllowedForGeneration("T8")) return;
  trySeedMonthEndT8Block(ws);
  const phase = "COVERAGE";
  let progress = true;
  while (progress) {
    progress = false;
    for (const date of ws.days) {
      if (ws.hasPaoCoverage(date, "T8")) continue;
      const assigned = tryAssignT8CoverageGap(ws, date);
      if (assigned) {
        progress = true;
        continue;
      }
      ws.audit.record("COVERAGE_FAILED", phase, "nenhum bloco T8/T8/ND elegível", {
        date,
        shiftCode: "T8",
      });
    }
  }
}

/**
 * Aloca blocos T8/T8/ND por calendário + antiguidade:
 * no dia de início mais cedo possível, tenta o PAO mais antigo; se não couber (ex.: simulador),
 * passa ao próximo; após alocar, recomeça do dia 1.
 */
export function fillT8PreferredBlocks(ws: CleanWorkspace): void {
  if (ws.usesNextMotorRules() && !motorRuleEnabled(ws.options, "preferred_shifts")) return;
  if (!ws.isShiftAllowedForGeneration("T8")) return;

  const employees = sortPaoBySeniority(
    ws.paoEmployees.filter((e) => isT8PreferredPao(ws, e.uuid)),
  );

  while (tryPlaceNextT8BlockByDayAndSeniority(ws, employees)) {
    // próximo bloco: revarre dias 1..N pela ordem de antiguidade
  }
}

/** Remove T8 isolado (sem par consecutivo) de PAOs preferindo T8 — bloco é a forma correta. */
export function removeIsolatedT8ForPreferredPaos(ws: CleanWorkspace): void {
  for (const emp of ws.paoEmployees) {
    if (!isT8PreferredPao(ws, emp.uuid)) continue;
    const did = emp.domainId;
    for (const day of ws.days) {
      if (ws.getShiftOnDay(did, day)?.toUpperCase() !== "T8") continue;
      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const hasPair =
        ws.getShiftOnDay(did, prev)?.toUpperCase() === "T8" ||
        ws.getShiftOnDay(did, next)?.toUpperCase() === "T8" ||
        ws.getCrossMonthShiftOnDay(did, next)?.toUpperCase() === "T8";
      if (hasPair) continue;
      if (ws.isLockedRateioDay(emp.uuid, day)) continue;
      ws.unassignPlannedDay(did, day);
      ws.audit.record("COVERAGE_FAILED", PHASE, "T8 isolado removido — use bloco T8/T8/ND", {
        date: day,
        shiftCode: "T8",
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      });
    }
  }
}
