import type { Employee } from "../employee/types.js";
import type { Shift } from "../shift/types.js";

export type Severity = "BAIXA" | "MÉDIA" | "ALTA" | "CRÍTICA";

export type ViolationLevel = "CRITICAL" | "WARNING" | "INFO";

export interface ValidationIssue {
  severity: Severity;
  /** Classificação Fase 5.1 — prevalece na publicação. */
  level?: ViolationLevel;
  type: string;
  date: string;
  employee: string;
  detail: string;
}

export interface ScheduleAssignment {
  employeeId: number;
  employeeName: string;
  workDate: string;
  shiftCode: string;
}

export interface ScheduleAllocation {
  employeeId: number;
  employeeName: string;
  allocDate: string;
  allocType: string;
}

export interface ScheduleContext {
  year: number;
  month: number;
  employees: Employee[];
  shifts: Shift[];
  assignments: ScheduleAssignment[];
  allocations: ScheduleAllocation[];
  /** employeeId → turnos bloqueados no mês */
  shiftRestrictions?: Map<number, Set<string>>;
  /** employeeId → turnos preferidos no cadastro */
  preferredShifts?: Map<number, Set<string>>;
  /** assignments do fim do mês anterior (continuidade 6x1 / 12h) */
  previousMonthAssignments?: ScheduleAssignment[];
  /** Datas reais de folga pedida (requested-day-offs) por employeeId */
  requestedOffByEmployeeId?: Record<number, string[]>;
  /** T8 isolado emergencial pós-dedup (`employeeId|day`) — auditar como WARNING, não CRITICAL. */
  emergencyIsolatedT8Keys?: Set<string>;
}

export type PlannedMap = Map<string, string>;
export type BlockedMap = Map<string, string>;

export function assignmentKey(employeeId: number, day: string): string {
  return `${employeeId}|${day}`;
}

export function parseAssignmentKey(key: string): { employeeId: number; day: string } {
  const [id, day] = key.split("|");
  return { employeeId: Number(id), day };
}
