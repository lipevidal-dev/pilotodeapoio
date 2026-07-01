import type { Employee, EmployeeFlightRestriction, EmployeePreferredShift, EmployeeShiftRestriction, Role, Shift } from "@prisma/client";

import { formatSeniorityLabel } from "../../domain/employee/seniority.js";
import { parseFcfScheduleJson } from "../../domain/employee/fcf-config.js";

import { isoDateKey } from "../../domain/rules/date-keys.js";



export interface RestrictedShiftSummary {

  id: string;

  code: string;

  name: string;

}



export interface PreferredShiftSummary {
  id: string;
  code: string;
  name: string;
}

export interface SpecificShiftRequestSummary {
  shiftId: string;
  shiftCode: string;
  shiftName: string;
  year: number | null;
  month: number | null;
  dayOfMonth: number | null;
  weekday: number | null;
}

export interface FcfScheduleSummary {
  shiftId: string;
  weekday: number;
  shiftCode?: string;
  shiftName?: string;
}

export interface EmployeeApiRecord {

  id: string;

  name: string;

  /** Compatibilidade — código do cargo (PAO/APAO) */

  type: string;

  roleId: string | null;

  cargoCode: string;

  cargoName: string;

  seniorityNumber: number;

  seniorityLabel: string;

  active: boolean;

  birthDate: string | null;

  noFlightDates: string[];

  restrictedShiftIds: string[];

  restrictedShifts: RestrictedShiftSummary[];

  preferredShiftIds: string[];

  preferredShifts: PreferredShiftSummary[];

  specificShiftRequests: SpecificShiftRequestSummary[];

  isFcf: boolean;

  fcfSchedule: FcfScheduleSummary[];

  inInstruction: boolean;

  createdAt: string;

  updatedAt: string;

}



type ShiftRestrictionWithShift = EmployeeShiftRestriction & { shift: Shift };



type PreferredShiftWithShift = EmployeePreferredShift & { shift: Shift };

type SpecificShiftRequestWithShift = import("@prisma/client").EmployeeSpecificShiftRequest & {
  shift: Shift;
};

type EmployeeWithRole = Employee & {

  role?: Role | null;

  flightRestrictions?: EmployeeFlightRestriction[];

  shiftRestrictions?: ShiftRestrictionWithShift[];

  preferredShifts?: PreferredShiftWithShift[];

  specificShiftRequests?: SpecificShiftRequestWithShift[];

};



export function employeeToApi(row: EmployeeWithRole, shiftById?: Map<string, Shift>): EmployeeApiRecord {

  const cargoCode = row.role?.code ?? row.type;

  const cargoName = row.role?.name ?? row.type;

  const flightDates = (row.flightRestrictions ?? [])

    .map((r) => isoDateKey(r.date))

    .sort();

  const shiftRows = row.shiftRestrictions ?? [];
  const preferredRows = row.preferredShifts ?? [];
  const specificRows = row.specificShiftRequests ?? [];

  return {

    id: row.id,

    name: row.name,

    type: cargoCode,

    roleId: row.roleId,

    cargoCode,

    cargoName,

    seniorityNumber: row.seniorityNumber,

    seniorityLabel: formatSeniorityLabel(cargoCode, row.seniorityNumber),

    active: row.active,

    birthDate: row.birthDate ? isoDateKey(row.birthDate) : null,

    noFlightDates: flightDates,

    restrictedShiftIds: shiftRows.map((r) => r.shiftId),

    restrictedShifts: shiftRows.map((r) => ({

      id: r.shift.id,

      code: r.shift.code,

      name: r.shift.name,

    })),

    preferredShiftIds: preferredRows.map((r) => r.shiftId),

    preferredShifts: preferredRows.map((r) => ({

      id: r.shift.id,

      code: r.shift.code,

      name: r.shift.name,

    })),

    specificShiftRequests: specificRows.map((r) => ({
      shiftId: r.shiftId,
      shiftCode: r.shift.code,
      shiftName: r.shift.name,
      year: r.year,
      month: r.month,
      dayOfMonth: r.dayOfMonth,
      weekday: r.weekday,
    })),

    isFcf: row.isFcf ?? false,

    fcfSchedule: parseFcfScheduleJson(row.fcfSchedule).map((entry) => ({
      shiftId: entry.shiftId,
      weekday: entry.weekday,
      shiftCode: shiftById?.get(entry.shiftId)?.code,
      shiftName: shiftById?.get(entry.shiftId)?.name,
    })),

    inInstruction: row.inInstruction ?? false,

    createdAt: row.createdAt.toISOString(),

    updatedAt: row.updatedAt.toISOString(),

  };

}


