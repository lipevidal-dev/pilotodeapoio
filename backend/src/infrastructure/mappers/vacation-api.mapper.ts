import type { Employee, Vacation } from "@prisma/client";
import { isoDateKey } from "../../domain/rules/date-keys.js";

export interface VacationApiRecord {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: {
    id: string;
    name: string;
    type: string;
    active: boolean;
  };
}

type VacationRow = Vacation & { employee?: Employee };

export function vacationToApi(row: VacationRow): VacationApiRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    startDate: isoDateKey(row.startDate),
    endDate: isoDateKey(row.endDate),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    employee: row.employee
      ? {
          id: row.employee.id,
          name: row.employee.name,
          type: row.employee.type,
          active: row.employee.active,
        }
      : undefined,
  };
}
