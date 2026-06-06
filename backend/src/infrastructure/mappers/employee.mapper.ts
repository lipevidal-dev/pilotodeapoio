import type { Employee as PrismaEmployee, EmployeeType, Role } from "@prisma/client";
import type { Employee as DomainEmployee } from "../../domain/employee/types.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";

type PrismaEmployeeWithRole = PrismaEmployee & { role?: Role | null };

export function prismaEmployeeToDomain(row: PrismaEmployeeWithRole, seniority = 1): DomainEmployee {
  const roleCode = row.role?.code ?? row.type;
  return {
    id: hashUuidToNumber(row.id),
    name: row.name,
    role: roleCode as DomainEmployee["role"],
    seniority,
    active: row.active,
    birthDate: row.birthDate ? isoDateKey(row.birthDate) : null,
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
