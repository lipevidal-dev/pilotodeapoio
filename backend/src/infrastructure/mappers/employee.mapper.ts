import type { Employee as PrismaEmployee, EmployeeType, Role } from "@prisma/client";
import type { Employee as DomainEmployee } from "../../domain/employee/types.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";

export type PrismaEmployeeWithRole = PrismaEmployee & { role?: Role | null };

/** Cargo efetivo: prioriza Role cadastrado sobre enum legacy `type`. */
export function employeeCargoCode(row: PrismaEmployeeWithRole): string {
  return row.role?.code ?? row.type;
}

export function prismaEmployeeToDomain(row: PrismaEmployeeWithRole): DomainEmployee {
  const roleCode = employeeCargoCode(row);
  return {
    id: hashUuidToNumber(row.id),
    name: row.name,
    role: roleCode as DomainEmployee["role"],
    seniority: row.seniorityNumber,
    active: row.active,
    birthDate: row.birthDate ? isoDateKey(row.birthDate) : null,
    inInstruction: row.inInstruction ?? false,
  };
}

export function domainTypeFromPrisma(type: EmployeeType): "PAO" | "APAO" {
  return type;
}

/** Mapeia UUID estável para número usado pelo domínio (Fase 1). */
export function hashUuidToNumber(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) >>> 0;
  }
  return (h % 900_000) + 1;
}

export function employeeTypeFromName(role: string): EmployeeType {
  return role.toUpperCase() === "APAO" ? "APAO" : "PAO";
}
