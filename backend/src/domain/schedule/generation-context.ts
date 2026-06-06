import type { ScheduleAssignment, ScheduleContext } from "./types.js";
import type {
  GeneratedAllocation,
  GeneratedAssignment,
  GenerationInput,
} from "./generation-types.js";

export function crossHistoryToPreviousMonthAssignments(
  input: GenerationInput,
): ScheduleAssignment[] | undefined {
  const hist = input.crossMonthHistory?.assignments;
  if (!hist?.length) return undefined;

  const byUuid = new Map(input.employees.map((e) => [e.uuid, e]));
  const rows: ScheduleAssignment[] = [];

  for (const a of hist) {
    const emp = byUuid.get(a.employeeUuid);
    if (!emp) continue;
    rows.push({
      employeeId: emp.domainId,
      employeeName: emp.employee.name,
      workDate: a.date,
      shiftCode: a.shiftCode,
    });
  }

  return rows.length > 0 ? rows : undefined;
}

export function generationToScheduleContext(
  input: GenerationInput,
  assignments: GeneratedAssignment[],
  allocations: GeneratedAllocation[],
): ScheduleContext {
  const byUuid = new Map(input.employees.map((e) => [e.uuid, e]));

  const requestedOffByEmployeeId: Record<number, string[]> = {};
  for (const fp of input.approvedDayOff) {
    const emp = byUuid.get(fp.employeeUuid);
    if (!emp) continue;
    const list = requestedOffByEmployeeId[emp.domainId] ?? [];
    if (!list.includes(fp.date)) list.push(fp.date);
    requestedOffByEmployeeId[emp.domainId] = list;
  }

  return {
    year: input.year,
    month: input.month,
    employees: input.employees.map((e) => ({ ...e.employee, id: e.domainId })),
    shifts: input.shifts,
    requestedOffByEmployeeId,
    shiftRestrictions: input.shiftRestrictions,
    previousMonthAssignments: crossHistoryToPreviousMonthAssignments(input),
    assignments: assignments.map((a) => {
      const emp = byUuid.get(a.employeeUuid)!;
      return {
        employeeId: emp.domainId,
        employeeName: emp.employee.name,
        workDate: a.date,
        shiftCode: a.shiftCode,
      };
    }),
    allocations: allocations.map((al) => {
      const emp = byUuid.get(al.employeeUuid)!;
      return {
        employeeId: emp.domainId,
        employeeName: emp.employee.name,
        allocDate: al.date,
        allocType: al.label,
      };
    }),
  };
}

export function buildEmployeeMaps<T extends { id: string; name: string; type: string }>(
  employees: T[],
): {
  sorted: T[];
  uuidToDomainId: Map<string, number>;
  domainIdToUuid: Map<number, string>;
} {
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
  const uuidToDomainId = new Map<string, number>();
  const domainIdToUuid = new Map<number, string>();
  sorted.forEach((e, i) => {
    const n = i + 1;
    uuidToDomainId.set(e.id, n);
    domainIdToUuid.set(n, e.id);
  });
  return { sorted, uuidToDomainId, domainIdToUuid };
}
