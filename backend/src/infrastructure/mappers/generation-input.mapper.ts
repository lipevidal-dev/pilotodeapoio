import type { Employee, PreAllocation, Role, Shift } from "@prisma/client";
import type { GenerationInput, GenerationInputEmployee } from "../../domain/schedule/generation-types.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import { resolveMotorRoleCodes } from "../../domain/role/motor-codes.js";
import { normalizeOperationalLabel } from "../../domain/schedule/operational-labels.js";
import { prismaEmployeeToDomain } from "./employee.mapper.js";
import { prismaShiftToDomain } from "./shift.mapper.js";

type EmployeeWithRole = Employee & { role?: Role | null };

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
}): GenerationInput {  const sorted = [...params.employees].sort((a, b) => a.name.localeCompare(b.name));
  const genEmployees: GenerationInputEmployee[] = sorted.map((e, i) => ({
    uuid: e.id,
    domainId: i + 1,
    employee: { ...prismaEmployeeToDomain(e, i + 1), id: i + 1 },
  }));

  const motorRoleCodes = resolveMotorRoleCodes(params.roles ?? []);

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
  };
}
export function preAllocationsToLocked(
  rows: (PreAllocation & { employee: Employee })[],
): Array<{ employeeUuid: string; date: string; label: string }> {
  return rows.map((p) => ({
    employeeUuid: p.employeeId,
    date: isoDateKey(p.date),
    label: normalizeOperationalLabel(p.label),
  }));
}
