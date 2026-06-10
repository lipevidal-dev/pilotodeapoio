import type { Shift as PrismaShift } from "@prisma/client";
import type { Shift as DomainShift } from "../../domain/shift/types.js";

export function prismaShiftToDomain(row: PrismaShift): DomainShift {
  const role =
    row.employeeTypeAllowed === "APAO"
      ? "APAO"
      : row.employeeTypeAllowed === "BOTH"
        ? "BOTH"
        : "PAO";

  return {
    code: row.code,
    role,
    name: row.name,
    startTime: row.startTime,
    endTime: row.endTime,
    minStaff: 1,
    maxStaff: 1,
    active: row.active,
    coverageType: row.coverageType,
  };
}
