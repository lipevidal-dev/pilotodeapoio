import { compareEmployeesBySeniority } from "../../domain/employee/seniority.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import type {
  ScheduleAssignment,
  ScheduleAllocation,
  ScheduleContext,
} from "../../domain/schedule/types.js";
import type { Employee as DomainEmployee } from "../../domain/employee/types.js";
import type { Shift as DomainShift } from "../../domain/shift/types.js";
import { employeeCargoCode, prismaEmployeeToDomain, type PrismaEmployeeWithRole } from "./employee.mapper.js";
import { prismaShiftToDomain } from "./shift.mapper.js";
import type {
  Employee,
  PreAllocation,
  ScheduleAssignment as PrismaAssignment,
  Shift,
} from "@prisma/client";

function mergeEmployeeRecord(
  existing: PrismaEmployeeWithRole | undefined,
  incoming: PrismaEmployeeWithRole,
): PrismaEmployeeWithRole {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    role: incoming.role ?? existing.role,
  };
}

export interface ScheduleContextInputDto {
  year: number;
  month: number;
  employees: Array<{
    id: number;
    name: string;
    role: string;
    seniority?: number;
    active?: boolean;
    fixedShiftCode?: string | null;
    isFixedShift?: boolean;
  }>;
  shifts: Array<{
    code: string;
    role: string;
    name: string;
    startTime: string;
    endTime: string;
    minStaff?: number;
    maxStaff?: number;
    noWeekends?: boolean;
  }>;
  assignments: Array<{
    employeeId: number;
    employeeName: string;
    workDate: string;
    shiftCode: string;
  }>;
  allocations: Array<{
    employeeId: number;
    employeeName: string;
    allocDate: string;
    allocType: string;
  }>;
  shiftRestrictions?: Record<string, string[]>;
  previousMonthAssignments?: Array<{
    employeeId: number;
    employeeName: string;
    workDate: string;
    shiftCode: string;
  }>;
}

export function dtoToScheduleContext(dto: ScheduleContextInputDto): ScheduleContext {
  const shiftRestrictions = new Map<number, Set<string>>();
  if (dto.shiftRestrictions) {
    for (const [empId, codes] of Object.entries(dto.shiftRestrictions)) {
      shiftRestrictions.set(Number(empId), new Set(codes));
    }
  }

  return {
    year: dto.year,
    month: dto.month,
    employees: dto.employees.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role as DomainEmployee["role"],
      seniority: e.seniority ?? 1,
      active: e.active ?? true,
      fixedShiftCode: e.fixedShiftCode,
      isFixedShift: e.isFixedShift,
    })),
    shifts: dto.shifts.map((s) => ({
      code: s.code,
      role: s.role as DomainShift["role"],
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      minStaff: s.minStaff ?? 1,
      maxStaff: s.maxStaff ?? 1,
      noWeekends: s.noWeekends,
    })),
    assignments: dto.assignments,
    allocations: dto.allocations,
    shiftRestrictions: shiftRestrictions.size > 0 ? shiftRestrictions : undefined,
    previousMonthAssignments: dto.previousMonthAssignments,
  };
}

export function buildContextFromDbParts(params: {
  year: number;
  month: number;
  employees: Employee[];
  shifts: Shift[];
  assignments: (PrismaAssignment & { employee: Employee })[];
  preAllocations: (PreAllocation & { employee: Employee })[];
}): { context: ScheduleContext; uuidToDomainId: Map<string, number> } {
  const byUuid = new Map<string, PrismaEmployeeWithRole>();
  for (const e of params.employees) byUuid.set(e.id, e);
  for (const a of params.assignments) {
    byUuid.set(
      a.employee.id,
      mergeEmployeeRecord(byUuid.get(a.employee.id), a.employee as PrismaEmployeeWithRole),
    );
  }
  for (const p of params.preAllocations) {
    byUuid.set(
      p.employee.id,
      mergeEmployeeRecord(byUuid.get(p.employee.id), p.employee as PrismaEmployeeWithRole),
    );
  }

  const sorted = [...byUuid.values()].sort((a, b) =>
    compareEmployeesBySeniority(
      { type: employeeCargoCode(a), seniorityNumber: a.seniorityNumber, name: a.name },
      { type: employeeCargoCode(b), seniorityNumber: b.seniorityNumber, name: b.name },
    ),
  );
  const idMap = new Map(sorted.map((e, i) => [e.id, i + 1]));

  const domainEmployees = sorted.map((e, i) => ({
    ...prismaEmployeeToDomain(e),
    id: i + 1,
  }));

  const assignments: ScheduleAssignment[] = params.assignments.map((a) => {
    const empId = idMap.get(a.employeeId);
    if (empId == null) {
      throw new Error(`Assignment employee ${a.employeeId} not in schedule context`);
    }
    return {
      employeeId: empId,
      employeeName: a.employee.name,
      workDate: formatDate(a.date),
      shiftCode: a.shiftCode,
    };
  });

  const allocations: ScheduleAllocation[] = params.preAllocations.map((p) => {
    const empId = idMap.get(p.employeeId);
    if (empId == null) {
      throw new Error(`PreAllocation employee ${p.employeeId} not in schedule context`);
    }
    return {
      employeeId: empId,
      employeeName: p.employee.name,
      allocDate: formatDate(p.date),
      allocType: p.label,
    };
  });

  return {
    context: {
      year: params.year,
      month: params.month,
      employees: domainEmployees,
      shifts: params.shifts.map(prismaShiftToDomain),
      assignments,
      allocations,
    },
    uuidToDomainId: idMap,
  };
}

function formatDate(d: Date): string {
  return isoDateKey(d);
}

export function domainEmployeesFromDtoList(
  employees: ScheduleContextInputDto["employees"],
): DomainEmployee[] {
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role as DomainEmployee["role"],
    seniority: e.seniority ?? 1,
    active: e.active ?? true,
    fixedShiftCode: e.fixedShiftCode,
    isFixedShift: e.isFixedShift,
  }));
}
