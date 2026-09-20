import type { Employee, Role, Shift } from "@prisma/client";
import type {
  GenerationInput,
  GenerationInputEmployee,
  PreferredShiftRow,
  ShiftRestrictionRow,
  SpecificShiftDayPreferenceRow,
} from "../../domain/schedule/generation-types.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import { resolveMotorRoleCodes } from "../../domain/role/motor-codes.js";
import { addDays, iterDays } from "../../domain/rules/dates.js";
import {
  CROSS_MONTH_ND_LABEL,
  normalizeOperationalLabel,
} from "../../domain/schedule/operational-labels.js";
import { compareEmployeesBySeniority } from "../../domain/employee/seniority.js";
import { expandSpecificShiftRequests } from "../../domain/schedule/specific-shift-requests.js";
import type { EmployeeFcfRule } from "../../domain/employee/fcf-config.js";
import { buildFcfRulesFromMotorPrefs } from "../../domain/schedule/next-motor/next-motor-employee-prefs.js";
import type { EmployeeMotorPrefStored } from "../../domain/schedule/next-motor/next-motor-stored-config.js";
import { prismaEmployeeToDomain } from "./employee.mapper.js";
import { prismaShiftToDomain } from "./shift.mapper.js";
import type { CrossMonthHistory } from "../../domain/schedule/cross-month-history.js";

type EmployeeWithRole = Employee & { role?: Role | null };
type PreAllocationLockRow = {
  employeeId: string;
  date: Date;
  label: string;
  notes?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

export function buildFcfRules(
  employees: EmployeeWithRole[],
  shifts: Shift[],
  employeePrefs?: Record<string, EmployeeMotorPrefStored>,
): EmployeeFcfRule[] {
  return buildFcfRulesFromMotorPrefs({
    employees,
    employeePrefs,
    shifts,
  });
}

export function buildGenerationInput(params: {
  year: number;
  month: number;
  employees: EmployeeWithRole[];
  shifts: Shift[];
  roles?: Role[];
  lockedAllocations: Array<{ employeeUuid: string; date: string; label: string }>;
  vacationDays: Array<{ employeeUuid: string; date: string }>;
  vacationReturnDays?: Array<{ employeeUuid: string; date: string }>;
  approvedDayOff: Array<{ employeeUuid: string; date: string }>;
  flightDays: Array<{ employeeUuid: string; date: string; description?: string }>;
  crossMonthHistory?: import("../../domain/schedule/cross-month-history.js").CrossMonthHistory;
  shiftRestrictionRows?: ShiftRestrictionRow[];
  preferredShiftRows?: PreferredShiftRow[];
  specificShiftDayPreferences?: SpecificShiftDayPreferenceRow[];
  noFlightDates?: Array<{ employeeUuid: string; date: string }>;
  employeePrefs?: Record<string, EmployeeMotorPrefStored>;
}): GenerationInput {
  const sorted = [...params.employees].sort(compareEmployeesBySeniority);
  const genEmployees: GenerationInputEmployee[] = sorted.map((e, i) => ({
    uuid: e.id,
    domainId: i + 1,
    employee: { ...prismaEmployeeToDomain(e), id: i + 1 },
  }));

  const motorRoleCodes = resolveMotorRoleCodes(params.roles ?? []);
  const days = iterDays(params.year, params.month);
  const specificShiftDayPreferences = params.specificShiftDayPreferences ?? [];
  const specificShiftRequests = expandSpecificShiftRequests(
    params.year,
    params.month,
    days,
    specificShiftDayPreferences,
  );
  const fcfRules = buildFcfRules(sorted, params.shifts, params.employeePrefs);

  return {
    year: params.year,
    month: params.month,
    employees: genEmployees,
    shifts: params.shifts.map(prismaShiftToDomain),
    motorRoleCodes,
    lockedAllocations: params.lockedAllocations,
    vacationDays: params.vacationDays,
    vacationReturnDays: params.vacationReturnDays,
    approvedDayOff: params.approvedDayOff,
    flightDays: params.flightDays,
    crossMonthHistory: params.crossMonthHistory,
    shiftRestrictions: buildShiftRestrictionMap(genEmployees, params.shiftRestrictionRows ?? []),
    preferredShifts: buildPreferredShiftMap(genEmployees, params.preferredShiftRows ?? []),
    noFlightDates: params.noFlightDates ?? [],
    specificShiftDayPreferences,
    specificShiftRequests,
    fcfRules,
  };
}

export function buildShiftRestrictionMap(
  employees: GenerationInputEmployee[],
  rows: ShiftRestrictionRow[],
): Map<number, Set<string>> | undefined {
  if (rows.length === 0) return undefined;

  const uuidToDomain = new Map(employees.map((e) => [e.uuid, e.domainId]));
  const map = new Map<number, Set<string>>();

  for (const row of rows) {
    const domainId = uuidToDomain.get(row.employeeUuid);
    if (domainId == null) continue;
    const codes = map.get(domainId) ?? new Set<string>();
    codes.add(row.shiftCode.toUpperCase());
    map.set(domainId, codes);
  }

  return map.size > 0 ? map : undefined;
}

export function buildPreferredShiftMap(
  employees: GenerationInputEmployee[],
  rows: PreferredShiftRow[],
): Map<number, Set<string>> | undefined {
  if (rows.length === 0) return undefined;

  const uuidToDomain = new Map(employees.map((e) => [e.uuid, e.domainId]));
  const map = new Map<number, Set<string>>();

  for (const row of rows) {
    const domainId = uuidToDomain.get(row.employeeUuid);
    if (domainId == null) continue;
    const codes = map.get(domainId) ?? new Set<string>();
    codes.add(row.shiftCode.toUpperCase());
    map.set(domainId, codes);
  }

  return map.size > 0 ? map : undefined;
}

export function preAllocationsToLocked(
  rows: PreAllocationLockRow[],
): Array<{ employeeUuid: string; date: string; label: string; startTime?: string; endTime?: string }> {
  return rows.map((p) => ({
    employeeUuid: p.employeeId,
    date: isoDateKey(p.date),
    label: normalizeOperationalLabel(p.label),
    startTime: p.startTime ?? undefined,
    endTime: p.endTime ?? undefined,
  }));
}

/**
 * Remove continuidades cross-month que sobraram de uma geração anterior e não
 * são mais sustentadas pelo histórico **realizado** do mês anterior (espelho −6).
 *
 * Ex.: se outubro mudou e o funcionário não fecha mais com 6 turnos, FOLGA em
 * 01/11 deixa de ser obrigatória. T8/ND CONTINUIDADE seguem a mesma ideia.
 */
export function filterStaleCrossMonthPreAllocations(
  rows: PreAllocationLockRow[],
  crossMonthHistory?: CrossMonthHistory,
): PreAllocationLockRow[] {
  const planned = new Map(
    (crossMonthHistory?.assignments ?? []).map((row) => [
      `${row.employeeUuid}|${row.date}`,
      row.shiftCode.toUpperCase(),
    ]),
  );
  const acceptedCrossMonthTurns = new Map<string, string>();
  const keep = new Set<PreAllocationLockRow>();

  const shiftOn = (employeeUuid: string, date: string): string | undefined =>
    acceptedCrossMonthTurns.get(`${employeeUuid}|${date}`) ??
    planned.get(`${employeeUuid}|${date}`);

  const consecutiveShiftsBefore = (employeeUuid: string, date: string): number => {
    let count = 0;
    let d = addDays(date, -1);
    while (shiftOn(employeeUuid, d)) {
      count++;
      d = addDays(d, -1);
    }
    return count;
  };

  const sorted = [...rows].sort((a, b) => isoDateKey(a.date).localeCompare(isoDateKey(b.date)));
  for (const row of sorted) {
    const label = normalizeOperationalLabel(row.label).toUpperCase();
    const isCrossMonth = String(row.notes ?? "").toLowerCase().startsWith("cross-month:");
    if (
      !isCrossMonth ||
      (label !== "T8" && label !== CROSS_MONTH_ND_LABEL.toUpperCase() && label !== "FOLGA")
    ) {
      keep.add(row);
      continue;
    }

    const date = isoDateKey(row.date);
    const prev = addDays(date, -1);
    const prev2 = addDays(date, -2);

    if (label === "FOLGA") {
      // Só turnos contam (igual ao espelho −6 da realizada).
      if (consecutiveShiftsBefore(row.employeeId, date) >= 6) {
        keep.add(row);
      }
      continue;
    }

    if (label === "T8") {
      if (shiftOn(row.employeeId, prev) === "T8") {
        keep.add(row);
        acceptedCrossMonthTurns.set(`${row.employeeId}|${date}`, "T8");
      }
      continue;
    }

    if (shiftOn(row.employeeId, prev) === "T8" && shiftOn(row.employeeId, prev2) === "T8") {
      keep.add(row);
    }
  }

  return rows.filter((row) => keep.has(row));
}

/** Turnos alocados manualmente na escala — preservados na regeneração sem validação de regras. */
export function manualAssignmentsToLocked(
  rows: Array<{ employeeId: string; date: Date; shiftCode: string; source: string }>,
): Array<{ employeeUuid: string; date: string; label: string }> {
  return rows
    .filter((a) => a.source === "MANUAL")
    .map((a) => ({
      employeeUuid: a.employeeId,
      date: isoDateKey(a.date),
      label: a.shiftCode.toUpperCase(),
    }));
}

export function mergeLockedAllocations(
  ...groups: Array<Array<{ employeeUuid: string; date: string; label: string; startTime?: string; endTime?: string }>>
): Array<{ employeeUuid: string; date: string; label: string; startTime?: string; endTime?: string }> {
  const map = new Map<string, { employeeUuid: string; date: string; label: string; startTime?: string; endTime?: string }>();
  for (const group of groups) {
    for (const row of group) {
      map.set(`${row.employeeUuid}|${row.date}`, row);
    }
  }
  return [...map.values()];
}

/** Mantém só pré-alocações de funcionários que entram na geração (ativos no input). */
export function filterLockedAllocationsForEmployees<
  T extends { employeeUuid: string },
>(locks: T[], employeeUuids: Iterable<string>): T[] {
  const active = new Set(employeeUuids);
  return locks.filter((row) => active.has(row.employeeUuid));
}
