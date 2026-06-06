import type { Employee } from "../employee/types.js";
import type { Shift } from "../shift/types.js";
import type { ValidationIssue } from "./types.js";
import type {
  CrossMonthHistory,
  VacationReturnDay,
} from "./cross-month-history.js";
import type {
  EmployeeOperationalSummary,
  OperationalTotals,
} from "./operational-summary.js";
export interface GenerationInputEmployee {
  uuid: string;
  domainId: number;
  employee: Employee;
}

export interface GenerationInput {
  year: number;
  month: number;
  employees: GenerationInputEmployee[];
  shifts: Shift[];
  /** Códigos de cargo ativos usados pelo motor (PAO/APAO). */
  motorRoleCodes?: { pao: string; apao: string };
  /** Pré-alocações fixas (admin) — não sobrescritas pelo motor */
  lockedAllocations: Array<{
    employeeUuid: string;
    date: string;
    label: string;
  }>;
  vacationDays: Array<{ employeeUuid: string; date: string }>;
  vacationReturnDays?: VacationReturnDay[];
  approvedDayOff: Array<{ employeeUuid: string; date: string }>;
  flightDays: Array<{ employeeUuid: string; date: string; description?: string }>;
  crossMonthHistory?: CrossMonthHistory;
  /** employeeId (domínio) → turnos bloqueados no mês */
  shiftRestrictions?: Map<number, Set<string>>;
}

export interface ShiftRestrictionRow {
  employeeUuid: string;
  shiftCode: string;
}
export interface GeneratedAssignment {
  employeeUuid: string;
  date: string;
  shiftCode: string;
}

export interface GeneratedAllocation {
  employeeUuid: string;
  date: string;
  label: string;
}

export interface GenerationSummary {
  totalAssignments: number;
  totalAllocations: number;
  paoCount: number;
  apaoCount: number;
  folgasPerPao: Record<string, number>;
  coverageGaps: number;
  repairsApplied?: number;
  blockingViolations: number;
  criticalViolations?: number;
  totalViolations: number;
  valid: boolean;
  criticalCount?: number;
  warningCount?: number;
  infoCount?: number;
  coverageMissingCount?: number;
  employeesUsed?: number;
  paosUsed?: number;
  apaosUsed?: number;
  daysInMonth?: number;
  generatedAt?: string;
  workloadByEmployee?: Record<string, number>;
  shiftsByCode?: Record<string, number>;
  daysWithFullCoverage?: number;
  impossibleScenario?: boolean;
  mainBlockingReasons?: string[];
  generationMs?: number;
  operationalByEmployee?: EmployeeOperationalSummary[];
  operationalTotals?: OperationalTotals;
  mathClosureOk?: boolean;
  paosCom11Folgas?: string[];
}

export interface GenerationResult {
  assignments: GeneratedAssignment[];
  allocations: GeneratedAllocation[];
  violations: ValidationIssue[];
  summary: GenerationSummary;
  success: boolean;
  suggestions: string[];
}
