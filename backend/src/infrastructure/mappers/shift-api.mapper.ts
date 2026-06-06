import type { Shift as PrismaShift } from "@prisma/client";

export interface ShiftApiRecord {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  roleType: string;
  active: boolean;
  displayOrder: number;
  mandatoryCoverage: boolean;
  requiresT8PairNd: boolean;
  durationHours: number;
  createdAt: string;
  updatedAt: string;
}

export function shiftToApi(row: PrismaShift): ShiftApiRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startTime: row.startTime,
    endTime: row.endTime,
    roleType: row.employeeTypeAllowed,
    active: row.active,
    displayOrder: row.displayOrder,
    mandatoryCoverage: row.mandatoryCoverage,
    requiresT8PairNd: row.requiresT8PairNd,
    durationHours: row.durationHours,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
