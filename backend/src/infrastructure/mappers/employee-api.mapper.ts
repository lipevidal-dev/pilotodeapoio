import type { Employee, Role } from "@prisma/client";
import { isoDateKey } from "../../domain/rules/date-keys.js";

export interface EmployeeApiRecord {
  id: string;
  name: string;
  /** Compatibilidade — código do cargo (PAO/APAO) */
  type: string;
  roleId: string | null;
  cargoCode: string;
  cargoName: string;
  active: boolean;
  birthDate: string | null;
  createdAt: string;
  updatedAt: string;
}

type EmployeeWithRole = Employee & { role?: Role | null };

export function employeeToApi(row: EmployeeWithRole): EmployeeApiRecord {
  const cargoCode = row.role?.code ?? row.type;
  const cargoName = row.role?.name ?? row.type;
  return {
    id: row.id,
    name: row.name,
    type: cargoCode,
    roleId: row.roleId,
    cargoCode,
    cargoName,
    active: row.active,
    birthDate: row.birthDate ? isoDateKey(row.birthDate) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
