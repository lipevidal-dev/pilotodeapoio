import { addDays } from "../rules/dates.js";
import { canWork } from "../rules/eligibility.js";
import { buildShiftMap } from "../shift/default-shifts.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type {
  ManualAllocationType,
  ManualEditCellRef,
  ManualEditConflict,
} from "./manual-edit-types.js";
import { PREALLOC_ALLOCATION_TYPES, SHIFT_ALLOCATION_TYPES } from "./manual-edit-types.js";
import type { ScheduleContext } from "./types.js";
import { assignmentKey } from "./types.js";

export interface DayOccupancy {
  shiftCode?: string;
  preallocLabel?: string;
  hasFlight: boolean;
  hasVacation: boolean;
  hasRequestedOff: boolean;
}

export interface ManualEditValidationContext {
  scheduleContext: ScheduleContext;
  idByUuid: Map<string, number>;
  uuidById: Map<number, string>;
  shiftRestrictions: Map<string, Set<string>>;
  noFlightDates: Map<string, Set<string>>;
  vacationDates: Map<string, Set<string>>;
  requestedOffDates: Map<string, Set<string>>;
  occupancy: Map<string, DayOccupancy>;
}

function occKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

export function buildManualEditValidationContext(params: {
  ctx: ScheduleContext;
  employees: Array<{ id: string; name: string; role: string }>;
  shiftRestrictionRows: Array<{ employeeUuid: string; shiftCode: string }>;
  noFlightDates: Array<{ employeeUuid: string; date: string }>;
  vacationDays: Array<{ employeeUuid: string; date: string }>;
  approvedDayOff: Array<{ employeeUuid: string; date: string }>;
  assignments: Array<{ employeeId: string; date: string; shiftCode: string }>;
  preAllocations: Array<{ employeeId: string; date: string; label: string }>;
  flightDays: Array<{ employeeUuid: string; date: string }>;
}): ManualEditValidationContext {
  const sorted = [...params.employees];
  const idByUuid = new Map(sorted.map((e, i) => [e.id, i + 1]));
  const uuidById = new Map(sorted.map((e, i) => [i + 1, e.id]));

  const shiftRestrictions = new Map<string, Set<string>>();
  for (const row of params.shiftRestrictionRows) {
    const set = shiftRestrictions.get(row.employeeUuid) ?? new Set<string>();
    set.add(row.shiftCode.toUpperCase());
    shiftRestrictions.set(row.employeeUuid, set);
  }

  const noFlightDates = new Map<string, Set<string>>();
  for (const row of params.noFlightDates) {
    const set = noFlightDates.get(row.employeeUuid) ?? new Set<string>();
    set.add(row.date);
    noFlightDates.set(row.employeeUuid, set);
  }

  const vacationDates = new Map<string, Set<string>>();
  for (const row of params.vacationDays) {
    const set = vacationDates.get(row.employeeUuid) ?? new Set<string>();
    set.add(row.date);
    vacationDates.set(row.employeeUuid, set);
  }

  const requestedOffDates = new Map<string, Set<string>>();
  for (const row of params.approvedDayOff) {
    const set = requestedOffDates.get(row.employeeUuid) ?? new Set<string>();
    set.add(row.date);
    requestedOffDates.set(row.employeeUuid, set);
  }

  const occupancy = new Map<string, DayOccupancy>();
  for (const a of params.assignments) {
    const key = occKey(a.employeeId, a.date);
    const cur = occupancy.get(key) ?? { hasFlight: false, hasVacation: false, hasRequestedOff: false };
    cur.shiftCode = a.shiftCode;
    occupancy.set(key, cur);
  }
  for (const p of params.preAllocations) {
    const key = occKey(p.employeeId, p.date);
    const cur = occupancy.get(key) ?? { hasFlight: false, hasVacation: false, hasRequestedOff: false };
    cur.preallocLabel = p.label;
    occupancy.set(key, cur);
  }
  for (const f of params.flightDays) {
    const key = occKey(f.employeeUuid, f.date);
    const cur = occupancy.get(key) ?? { hasFlight: false, hasVacation: false, hasRequestedOff: false };
    cur.hasFlight = true;
    occupancy.set(key, cur);
  }
  for (const [uuid, dates] of vacationDates) {
    for (const date of dates) {
      const key = occKey(uuid, date);
      const cur = occupancy.get(key) ?? { hasFlight: false, hasVacation: false, hasRequestedOff: false };
      cur.hasVacation = true;
      occupancy.set(key, cur);
    }
  }
  for (const [uuid, dates] of requestedOffDates) {
    for (const date of dates) {
      const key = occKey(uuid, date);
      const cur = occupancy.get(key) ?? { hasFlight: false, hasVacation: false, hasRequestedOff: false };
      cur.hasRequestedOff = true;
      occupancy.set(key, cur);
    }
  }

  const shiftRestrictionsDomain = new Map<number, Set<string>>();
  for (const [uuid, codes] of shiftRestrictions) {
    const did = idByUuid.get(uuid);
    if (did != null) shiftRestrictionsDomain.set(did, codes);
  }

  return {
    scheduleContext: {
      ...params.ctx,
      shiftRestrictions:
        shiftRestrictionsDomain.size > 0 ? shiftRestrictionsDomain : undefined,
    },
    idByUuid,
    uuidById,
    shiftRestrictions,
    noFlightDates,
    vacationDates,
    requestedOffDates,
    occupancy,
  };
}

function getOccupancy(v: ManualEditValidationContext, ref: ManualEditCellRef): DayOccupancy {
  return (
    v.occupancy.get(occKey(ref.employeeId, ref.date)) ?? {
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    }
  );
}

function employeeDomainId(v: ManualEditValidationContext, uuid: string): number | null {
  return v.idByUuid.get(uuid) ?? null;
}

function isFullMonthNoFlight(v: ManualEditValidationContext, uuid: string, year: number, month: number): boolean {
  const daysInMonth = new Date(year, month, 0).getDate();
  const set = v.noFlightDates.get(uuid);
  if (!set) return false;
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (set.has(iso)) count++;
  }
  return count >= daysInMonth;
}

function isT8BlockDay(v: ManualEditValidationContext, ref: ManualEditCellRef): boolean {
  const occ = getOccupancy(v, ref);
  if (occ.shiftCode === "T8") return true;
  const prev = { ...ref, date: addDays(ref.date, -1) };
  const next = { ...ref, date: addDays(ref.date, 1) };
  const prevOcc = getOccupancy(v, prev);
  const nextOcc = getOccupancy(v, next);
  if (occ.shiftCode === "T8" || prevOcc.shiftCode === "T8" || nextOcc.shiftCode === "T8") return true;
  const label = normalizeOperationalLabel(occ.preallocLabel ?? "").toUpperCase();
  if (label === "ND") {
    const d1 = addDays(ref.date, -2);
    const d2 = addDays(ref.date, -1);
    const o1 = getOccupancy(v, { employeeId: ref.employeeId, date: d1 });
    const o2 = getOccupancy(v, { employeeId: ref.employeeId, date: d2 });
    return o1.shiftCode === "T8" && o2.shiftCode === "T8";
  }
  return false;
}

function protectedOverwriteConflicts(
  v: ManualEditValidationContext,
  ref: ManualEditCellRef,
  force?: boolean,
): ManualEditConflict[] {
  if (force) return [];
  const occ = getOccupancy(v, ref);
  const conflicts: ManualEditConflict[] = [];
  if (occ.hasVacation) {
    conflicts.push({
      code: "PROTECTED_FERIAS",
      message: "Conflito: funcionário está de férias.",
      requiresConfirmation: true,
    });
  }
  if (occ.hasRequestedOff || normalizeOperationalLabel(occ.preallocLabel ?? "") === "FOLGA PEDIDA") {
    conflicts.push({
      code: "PROTECTED_FP",
      message: "Conflito: folga pedida não pode ser sobrescrita sem confirmação.",
      requiresConfirmation: true,
    });
  }
  if (normalizeOperationalLabel(occ.preallocLabel ?? "").toUpperCase() === "ND") {
    conflicts.push({
      code: "PROTECTED_ND",
      message: "Conflito: ND não pode ser sobrescrito sem confirmação.",
      requiresConfirmation: true,
    });
  }
  if (isT8BlockDay(v, ref)) {
    conflicts.push({
      code: "PROTECTED_T8_BLOCK",
      message: "Conflito: alteração pode quebrar bloco T8/T8/ND.",
      requiresConfirmation: true,
    });
  }
  return conflicts;
}

function buildPlannedMap(v: ManualEditValidationContext): Map<string, string> {
  const planned = new Map<string, string>();
  for (const [key, occ] of v.occupancy) {
    if (!occ.shiftCode) continue;
    const [uuid, date] = key.split("|") as [string, string];
    const did = employeeDomainId(v, uuid);
    if (did == null) continue;
    planned.set(assignmentKey(did, date), occ.shiftCode);
  }
  return planned;
}

function buildBlockedMap(v: ManualEditValidationContext): Map<string, string> {
  const blocked = new Map<string, string>();
  for (const [key, occ] of v.occupancy) {
    const [uuid, date] = key.split("|") as [string, string];
    const did = employeeDomainId(v, uuid);
    if (did == null) continue;
    if (occ.hasVacation) blocked.set(assignmentKey(did, date), "FÉRIAS");
    else if (occ.hasRequestedOff) blocked.set(assignmentKey(did, date), "FOLGA PEDIDA");
    else if (occ.preallocLabel) blocked.set(assignmentKey(did, date), occ.preallocLabel);
    else if (occ.hasFlight) blocked.set(assignmentKey(did, date), "VOO");
  }
  return blocked;
}

export function validateManualSet(
  v: ManualEditValidationContext,
  ref: ManualEditCellRef,
  type: ManualAllocationType,
  force?: boolean,
): ManualEditConflict[] {
  if (type === "CLEAR") {
    return protectedOverwriteConflicts(v, ref, force);
  }

  const conflicts = [...protectedOverwriteConflicts(v, ref, force)];
  const occ = getOccupancy(v, ref);
  const emp = v.scheduleContext.employees.find((e) => e.id === employeeDomainId(v, ref.employeeId));
  if (!emp) {
    conflicts.push({ code: "EMPLOYEE_NOT_FOUND", message: "Funcionário não encontrado." });
    return conflicts;
  }

  if (type === "VOO") {
    if (isFullMonthNoFlight(v, ref.employeeId, v.scheduleContext.year, v.scheduleContext.month)) {
      conflicts.push({
        code: "NO_FLIGHT_MONTH",
        message: "Conflito: funcionário possui restrição de voo no mês inteiro.",
      });
    }
    const nf = v.noFlightDates.get(ref.employeeId);
    if (nf?.has(ref.date)) {
      conflicts.push({
        code: "NO_FLIGHT_DAY",
        message: "Conflito: funcionário não pode receber voo neste dia.",
      });
    }
    return conflicts;
  }

  if (SHIFT_ALLOCATION_TYPES.has(type)) {
    const restricted = v.shiftRestrictions.get(ref.employeeId);
    if (restricted?.has(type)) {
      conflicts.push({
        code: "SHIFT_RESTRICTED",
        message: `Conflito: funcionário possui restrição para ${type}.`,
      });
    }
    if (occ.hasVacation) {
      conflicts.push({ code: "ON_VACATION", message: "Conflito: funcionário está de férias." });
    }
    const planned = buildPlannedMap(v);
    const blocked = buildBlockedMap(v);
    const shiftMap = buildShiftMap(v.scheduleContext.shifts);
    const roleMap = new Map(v.scheduleContext.employees.map((e) => [e.id, e.role]));
    const r = canWork(emp, ref.date, type, blocked, planned, {
      shiftMap,
      roleByEmployeeId: roleMap,
      shiftRestrictions: v.scheduleContext.shiftRestrictions,
    });
    if (!r.ok) {
      conflicts.push({ code: "CANNOT_WORK", message: `Conflito: ${r.reason}.` });
    }
    return conflicts;
  }

  if (PREALLOC_ALLOCATION_TYPES.has(type)) {
    if (occ.shiftCode && !force) {
      conflicts.push({
        code: "CELL_OCCUPIED",
        message: "Conflito: funcionário já possui turno neste dia.",
        requiresConfirmation: true,
      });
    }
    return conflicts;
  }

  return conflicts;
}

export function validateManualMove(
  v: ManualEditValidationContext,
  source: ManualEditCellRef,
  target: ManualEditCellRef,
  force?: boolean,
): ManualEditConflict[] {
  const src = getOccupancy(v, source);
  const conflicts: ManualEditConflict[] = [];

  if (!src.shiftCode && !src.preallocLabel && !src.hasFlight) {
    conflicts.push({ code: "EMPTY_SOURCE", message: "Conflito: célula de origem está vazia." });
    return conflicts;
  }

  let moveType: ManualAllocationType | null = null;
  if (src.shiftCode && ["T6", "T7", "T8"].includes(src.shiftCode)) {
    moveType = src.shiftCode as ManualAllocationType;
  } else if (src.hasFlight) {
    moveType = "VOO";
  } else if (src.preallocLabel) {
    const n = normalizeOperationalLabel(src.preallocLabel).toUpperCase();
    if (n === "ND") moveType = "ND";
    else if (n.includes("FOLGA PEDIDA")) moveType = "FP";
    else if (n === "FOLGA") moveType = "FOLGA";
    else if (n === "SIMULADOR") moveType = "SIMULADOR";
    else if (n === "CURSO" || n === "CURSO ONLINE") moveType = "CURSO";
    else if (n === "CMA") moveType = "CMA";
    else if (n === "OUTRO") moveType = "OUTRO";
  }

  if (!moveType || moveType === "CLEAR") {
    conflicts.push({ code: "UNMOVABLE", message: "Conflito: este tipo de alocação não pode ser movido." });
    return conflicts;
  }

  conflicts.push(...protectedOverwriteConflicts(v, source, force));
  conflicts.push(...protectedOverwriteConflicts(v, target, force));
  conflicts.push(...validateManualSet(v, target, moveType, force));

  const tgt = getOccupancy(v, target);
  if ((tgt.shiftCode || tgt.preallocLabel || tgt.hasFlight || tgt.hasVacation) && !force) {
    conflicts.push({
      code: "TARGET_OCCUPIED",
      message: "Conflito: funcionário destino já possui alocação neste dia.",
    });
  }

  if (src.shiftCode) {
    const sameShiftOnTargetDay = [...v.occupancy.entries()].some(([key, occ]) => {
      const [uuid, date] = key.split("|") as [string, string];
      return date === target.date && uuid !== target.employeeId && occ.shiftCode === src.shiftCode;
    });
    if (sameShiftOnTargetDay && target.employeeId !== source.employeeId) {
      conflicts.push({
        code: "SHIFT_COVERAGE",
        message: `Conflito: ${src.shiftCode} já coberto por outro funcionário em ${target.date.slice(8, 10)}/${target.date.slice(5, 7)}.`,
      });
    }
  }

  return conflicts;
}
