import { wouldApaoFolgaBlockOffice } from "../rules/apao-availability.js";
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
import {
  isDateInScheduleMonth,
  resolveT8BlockStart,
  t8BlockFromStart,
} from "./manual-edit-t8-block.js";
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
  nameByUuid: Map<string, string>;
  shiftRestrictions: Map<string, Set<string>>;
  preferredShifts: Map<string, Set<string>>;
  parallelShiftCodes: Set<string>;
  noFlightDates: Map<string, Set<string>>;
  vacationDates: Map<string, Set<string>>;
  requestedOffDates: Map<string, Set<string>>;
  occupancy: Map<string, DayOccupancy>;
}

function occKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

/** Alinha UUID → id numérico do domínio pelo nome (testes / contextos sintéticos). */
export function buildUuidToDomainIdByName(
  ctx: ScheduleContext,
  employees: Array<{ id: string; name: string }>,
): Map<string, number> {
  const nameToDomainId = new Map(ctx.employees.map((e) => [e.name, e.id]));
  const map = new Map<string, number>();
  for (const employee of employees) {
    const domainId = nameToDomainId.get(employee.name);
    if (domainId != null) map.set(employee.id, domainId);
  }
  return map;
}

export function buildManualEditValidationContext(params: {
  ctx: ScheduleContext;
  uuidToDomainId: Map<string, number>;
  employees: Array<{ id: string; name: string; role: string; seniorityNumber?: number }>;
  shiftRestrictionRows: Array<{ employeeUuid: string; shiftCode: string }>;
  preferredShiftRows?: Array<{ employeeUuid: string; shiftCode: string }>;
  noFlightDates: Array<{ employeeUuid: string; date: string }>;
  vacationDays: Array<{ employeeUuid: string; date: string }>;
  approvedDayOff: Array<{ employeeUuid: string; date: string }>;
  assignments: Array<{ employeeId: string; date: string; shiftCode: string }>;
  preAllocations: Array<{ employeeId: string; date: string; label: string }>;
  flightDays: Array<{ employeeUuid: string; date: string }>;
}): ManualEditValidationContext {
  const idByUuid = params.uuidToDomainId;
  const uuidById = new Map<number, string>();
  for (const [uuid, domainId] of idByUuid) {
    uuidById.set(domainId, uuid);
  }
  const nameByUuid = new Map(params.employees.map((e) => [e.id, e.name]));

  const shiftRestrictions = new Map<string, Set<string>>();
  for (const row of params.shiftRestrictionRows) {
    const set = shiftRestrictions.get(row.employeeUuid) ?? new Set<string>();
    set.add(row.shiftCode.toUpperCase());
    shiftRestrictions.set(row.employeeUuid, set);
  }

  const preferredShifts = new Map<string, Set<string>>();
  for (const row of params.preferredShiftRows ?? []) {
    const set = preferredShifts.get(row.employeeUuid) ?? new Set<string>();
    set.add(row.shiftCode.toUpperCase());
    preferredShifts.set(row.employeeUuid, set);
  }

  const parallelShiftCodes = new Set(
    params.ctx.shifts
      .filter((s) => s.coverageType === "PARALLEL")
      .map((s) => s.code.toUpperCase()),
  );

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

  const preferredShiftsDomain = new Map<number, Set<string>>();
  for (const [uuid, codes] of preferredShifts) {
    const did = idByUuid.get(uuid);
    if (did != null) preferredShiftsDomain.set(did, codes);
  }

  return {
    scheduleContext: {
      ...params.ctx,
      shiftRestrictions:
        shiftRestrictionsDomain.size > 0 ? shiftRestrictionsDomain : undefined,
      preferredShifts:
        preferredShiftsDomain.size > 0 ? preferredShiftsDomain : undefined,
    },
    idByUuid,
    uuidById,
    nameByUuid,
    shiftRestrictions,
    preferredShifts,
    parallelShiftCodes,
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

function isManualShiftAllocation(type: ManualAllocationType, v: ManualEditValidationContext): boolean {
  const upper = type.toUpperCase();
  if (SHIFT_ALLOCATION_TYPES.has(type) || v.parallelShiftCodes.has(type)) return true;
  return v.scheduleContext.shifts.some((s) => s.code.toUpperCase() === upper);
}

function preferredShiftsForCanWork(v: ManualEditValidationContext): Map<number, Set<string>> | undefined {
  const map = new Map<number, Set<string>>();
  for (const [uuid, codes] of v.preferredShifts) {
    const did = v.idByUuid.get(uuid);
    if (did != null) map.set(did, codes);
  }
  return map.size > 0 ? map : undefined;
}

/** VOO em preAllocation — pode ser substituído por turno manual. */
function isReplaceableMotorVooOccupancy(occ: DayOccupancy): boolean {
  if (occ.shiftCode || occ.hasVacation || occ.hasRequestedOff || occ.hasFlight) return false;
  return normalizeOperationalLabel(occ.preallocLabel ?? "").toUpperCase() === "VOO";
}

function isPreallocVoo(occ: DayOccupancy): boolean {
  return normalizeOperationalLabel(occ.preallocLabel ?? "").toUpperCase() === "VOO";
}

function buildBlockedMapForShiftPlacement(
  v: ManualEditValidationContext,
  ref: ManualEditCellRef,
): Map<string, string> {
  const blocked = buildBlockedMap(v);
  const occ = getOccupancy(v, ref);
  if (!isReplaceableMotorVooOccupancy(occ)) return blocked;
  const did = employeeDomainId(v, ref.employeeId);
  if (did != null) blocked.delete(assignmentKey(did, ref.date));
  return blocked;
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

/** Protege apenas dias dentro do bloco T8/T8/ND — não bloqueia dias anteriores ao par T8. */
function isT8BlockDay(v: ManualEditValidationContext, ref: ManualEditCellRef): boolean {
  const occ = getOccupancy(v, ref);
  const label = normalizeOperationalLabel(occ.preallocLabel ?? "").toUpperCase();
  if (label === "ND") {
    const d1 = addDays(ref.date, -1);
    const d2 = addDays(ref.date, -2);
    const o1 = getOccupancy(v, { employeeId: ref.employeeId, date: d1 });
    const o2 = getOccupancy(v, { employeeId: ref.employeeId, date: d2 });
    return o1.shiftCode === "T8" && o2.shiftCode === "T8";
  }
  if (occ.shiftCode === "T8") {
    const prevOcc = getOccupancy(v, { employeeId: ref.employeeId, date: addDays(ref.date, -1) });
    const nextOcc = getOccupancy(v, { employeeId: ref.employeeId, date: addDays(ref.date, 1) });
    return prevOcc.shiftCode === "T8" || nextOcc.shiftCode === "T8";
  }
  return false;
}

interface ProtectedOverwriteOptions {
  /** Alocação manual de bloco T8/T8/ND — permite sobrescrever o próprio bloco. */
  placingT8Block?: boolean;
}

function protectedOverwriteConflicts(
  v: ManualEditValidationContext,
  ref: ManualEditCellRef,
  force?: boolean,
  opts?: ProtectedOverwriteOptions,
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
  if (!opts?.placingT8Block && normalizeOperationalLabel(occ.preallocLabel ?? "").toUpperCase() === "ND") {
    conflicts.push({
      code: "PROTECTED_ND",
      message: "Conflito: ND não pode ser sobrescrito sem confirmação.",
      requiresConfirmation: true,
    });
  }
  if (!opts?.placingT8Block && isT8BlockDay(v, ref)) {
    conflicts.push({
      code: "PROTECTED_T8_BLOCK",
      message: "Conflito: alteração pode quebrar bloco T8/T8/ND.",
      requiresConfirmation: true,
    });
  }
  return conflicts;
}

function shiftOnDay(v: ManualEditValidationContext, employeeId: string, date: string): string | undefined {
  return getOccupancy(v, { employeeId, date }).shiftCode;
}

/** Bloco T8/T8/ND existente — T8 isolado (manual) move como célula única. */
function isExistingT8BlockMove(
  v: ManualEditValidationContext,
  source: ManualEditCellRef,
  moveType: ManualAllocationType,
  t8BlockStart: string | null,
): boolean {
  if (!t8BlockStart) return false;
  if (moveType === "ND") return true;
  if (moveType === "T8") {
    return shiftOnDay(v, source.employeeId, t8BlockFromStart(t8BlockStart).t8Second) === "T8";
  }
  return false;
}

export function validateManualT8BlockSet(
  v: ManualEditValidationContext,
  employeeId: string,
  startDate: string,
  force?: boolean,
): ManualEditConflict[] {
  const { year, month } = v.scheduleContext;
  const block = t8BlockFromStart(startDate);
  const conflicts: ManualEditConflict[] = [];

  if (!isDateInScheduleMonth(block.t8Second, year, month)) {
    conflicts.push({
      code: "T8_BLOCK_INCOMPLETE",
      message: "Conflito: bloco T8/T8/ND requer dois dias T8 consecutivos dentro do mês.",
    });
    return conflicts;
  }

  const emp = v.scheduleContext.employees.find((e) => e.id === employeeDomainId(v, employeeId));
  if (!emp) {
    conflicts.push({ code: "EMPLOYEE_NOT_FOUND", message: "Funcionário não encontrado." });
    return conflicts;
  }

  const planned = buildPlannedMap(v);
  const shiftMap = buildShiftMap(v.scheduleContext.shifts);
  const roleMap = new Map(v.scheduleContext.employees.map((e) => [e.id, e.role]));
  const blockOpts: ProtectedOverwriteOptions = { placingT8Block: true };

  for (const date of [block.t8First, block.t8Second]) {
    conflicts.push(
      ...protectedOverwriteConflicts(v, { employeeId, date }, force, blockOpts),
    );
    const restricted = v.shiftRestrictions.get(employeeId);
    if (restricted?.has("T8")) {
      conflicts.push({
        code: "SHIFT_RESTRICTED",
        message: "Conflito: funcionário possui restrição para T8.",
      });
    }
    const occ = getOccupancy(v, { employeeId, date });
    if (occ.hasVacation) {
      conflicts.push({ code: "ON_VACATION", message: "Conflito: funcionário está de férias." });
    }
    const blocked = buildBlockedMapForShiftPlacement(v, { employeeId, date });
    const r = canWork(emp, date, "T8", blocked, planned, {
      shiftMap,
      roleByEmployeeId: roleMap,
      shiftRestrictions: v.scheduleContext.shiftRestrictions,
      skipSimultaneousStationsCheck: true,
      skipApaoPaoCoverageCheck: true,
      skipApaoOverlapCheck: true,
    });
    if (!r.ok) {
      conflicts.push({ code: "CANNOT_WORK", message: `Conflito: ${r.reason}.` });
    }
  }

  if (isDateInScheduleMonth(block.nd, year, month)) {
    conflicts.push(
      ...protectedOverwriteConflicts(v, { employeeId, date: block.nd }, force, blockOpts),
    );
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

  if (type === "T8_BLOCK") {
    return validateManualT8BlockSet(v, ref.employeeId, ref.date, force);
  }

  if (isManualShiftAllocation(type, v)) {
    const restricted = v.shiftRestrictions.get(ref.employeeId);
    if (restricted?.has(type)) {
      conflicts.push({
        code: "SHIFT_RESTRICTED",
        message: `Conflito: funcionário possui restrição para ${type}.`,
      });
    }
    if (v.parallelShiftCodes.has(type)) {
      const pref = v.preferredShifts.get(ref.employeeId);
      if (!pref?.has(type)) {
        conflicts.push({
          code: "PARALLEL_SHIFT_NOT_PREFERRED",
          message: `Conflito: funcionário não possui preferência para ${type}.`,
        });
      }
      for (const [key, occ] of v.occupancy) {
        if (!key.endsWith(`|${ref.date}`)) continue;
        const [uuid] = key.split("|") as [string, string];
        if (uuid !== ref.employeeId && occ.shiftCode?.toUpperCase() === type) {
          conflicts.push({
            code: "PARALLEL_SHIFT_DAY_LIMIT",
            message: `Conflito: já existe ${type} alocado neste dia.`,
          });
          break;
        }
      }
    }
    if (occ.hasVacation) {
      conflicts.push({ code: "ON_VACATION", message: "Conflito: funcionário está de férias." });
    }

    const planned = buildPlannedMap(v);
    const blocked = buildBlockedMapForShiftPlacement(v, ref);
    const shiftMap = buildShiftMap(v.scheduleContext.shifts);
    const roleMap = new Map(v.scheduleContext.employees.map((e) => [e.id, e.role]));
    const r = canWork(emp, ref.date, type, blocked, planned, {
      shiftMap,
      roleByEmployeeId: roleMap,
      shiftRestrictions: v.scheduleContext.shiftRestrictions,
      preferredShifts: preferredShiftsForCanWork(v),
      parallelShiftCodes: v.parallelShiftCodes,
      skipSimultaneousStationsCheck: true,
      skipApaoPaoCoverageCheck: true,
      skipApaoOverlapCheck: true,
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
    if (type === "FOLGA" || type === "FP") {
      const did = employeeDomainId(v, ref.employeeId);
      if (
        did != null &&
        emp.role === "APAO" &&
        wouldApaoFolgaBlockOffice(v.scheduleContext, did, [ref.date])
      ) {
        conflicts.push({
          code: "SEM_APAO_DISPONIVEL",
          message:
            "Conflito: não pode deixar o escritório sem APAO disponível em dia com PAO em T6.",
        });
      }
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
  if (src.shiftCode && SHIFT_ALLOCATION_TYPES.has(src.shiftCode as ManualAllocationType)) {
    moveType = src.shiftCode as ManualAllocationType;
  } else if (src.hasFlight || isPreallocVoo(src)) {
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

  const t8BlockStart = resolveT8BlockStart(
    src.shiftCode,
    src.preallocLabel,
    source.date,
    (day) => shiftOnDay(v, source.employeeId, day),
  );
  const isT8BlockMove = isExistingT8BlockMove(v, source, moveType, t8BlockStart);

  if (isT8BlockMove && t8BlockStart) {
    const block = t8BlockFromStart(t8BlockStart);
    const movingOpts: ProtectedOverwriteOptions = { placingT8Block: true };
    for (const date of [block.t8First, block.t8Second, block.nd]) {
      const occ = getOccupancy(v, { employeeId: source.employeeId, date });
      if (occ.shiftCode || occ.preallocLabel) {
        conflicts.push(
          ...protectedOverwriteConflicts(v, { employeeId: source.employeeId, date }, force, movingOpts),
        );
      }
    }
    conflicts.push(...validateManualT8BlockSet(v, target.employeeId, target.date, force));
  } else {
    conflicts.push(...protectedOverwriteConflicts(v, source, force));
    conflicts.push(...protectedOverwriteConflicts(v, target, force));
    conflicts.push(...validateManualSet(v, target, moveType, force));

    const tgt = getOccupancy(v, target);
    const targetOnlyReplaceableVoo = isReplaceableMotorVooOccupancy(tgt);
    if (
      !targetOnlyReplaceableVoo &&
      (tgt.shiftCode || tgt.preallocLabel || tgt.hasFlight || tgt.hasVacation) &&
      !force
    ) {
      const occupiedLabel =
        tgt.shiftCode ??
        (tgt.hasVacation ? "férias" : tgt.hasFlight ? "VOO" : tgt.preallocLabel ?? "alocação");
      conflicts.push({
        code: "TARGET_OCCUPIED",
        message: `Conflito: funcionário já possui ${occupiedLabel} neste dia.`,
      });
    }
  }

  return conflicts;
}
