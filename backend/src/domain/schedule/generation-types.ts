import type { EmployeeFcfRule } from "../employee/fcf-config.js";
import type { Employee } from "../employee/types.js";
import type { Shift } from "../shift/types.js";
import type { ValidationIssue } from "./types.js";
import type {
  CrossMonthHistory,
  VacationReturnDay,
} from "./cross-month-history.js";

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
    startTime?: string;
    endTime?: string;
  }>;
  vacationDays: Array<{ employeeUuid: string; date: string }>;
  vacationReturnDays?: VacationReturnDay[];
  approvedDayOff: Array<{ employeeUuid: string; date: string }>;
  flightDays: Array<{ employeeUuid: string; date: string; description?: string }>;
  crossMonthHistory?: CrossMonthHistory;
  /** employeeId (domínio) → turnos bloqueados no mês */
  shiftRestrictions?: Map<number, Set<string>>;
  /** employeeId (domínio) → turnos preferidos (alocação específica) */
  preferredShifts?: Map<number, Set<string>>;
  /** Dias em que o funcionário não deve receber voo (não bloqueia turno). */
  noFlightDates?: Array<{ employeeUuid: string; date: string }>;
  /** Preferências de turno em dias específicos (cadastro admin — legado). */
  specificShiftDayPreferences?: SpecificShiftDayPreferenceRow[];
  /** Expandido para o mês — preenchido pelo mapper (legado). */
  specificShiftRequests?: SpecificShiftRequest[];
  /** Preferência FCF — alocação desejada por dia da semana (por funcionário). */
  fcfRules?: EmployeeFcfRule[];
}

export interface ShiftRestrictionRow {
  employeeUuid: string;
  shiftCode: string;
}

export interface PreferredShiftRow {
  employeeUuid: string;
  shiftCode: string;
}

/** Preferência forte: turno em dia do mês ou dia da semana. */
export interface SpecificShiftDayPreferenceRow {
  employeeUuid: string;
  shiftCode: string;
  year?: number | null;
  month?: number | null;
  dayOfMonth?: number | null;
  weekday?: number | null;
}

/** Alocação concreta expandida para o mês alvo. */
export interface SpecificShiftRequest {
  employeeUuid: string;
  date: string;
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
  startTime?: string;
  endTime?: string;
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
  operationalByEmployee?: unknown[];
  operationalTotals?: unknown;
  mathClosureOk?: boolean;
  paosCom11Folgas?: string[];
  t6BlockCoverage?: {
    blockCount: number;
    averageDays: number;
    unitOccurrences: number;
  };
  t7BlockCoverage?: {
    blockCount: number;
    averageDays: number;
    unitOccurrences: number;
  };
  unitCoverageTotal?: number;
  balanceReport?: unknown;
  motorVersion?: string;
  enginePath?: string;
  realEngineExecuted?: boolean;
  realMotorReport?: Record<string, unknown>;
  blockOptimizerMetrics?: unknown;
}

export interface GenerationResult {
  assignments: GeneratedAssignment[];
  allocations: GeneratedAllocation[];
  /** Pré-alocações fixas no mês seguinte (continuidade T8/T8/ND). */
  crossMonthPreAllocations?: GeneratedAllocation[];
  violations: ValidationIssue[];
  summary: GenerationSummary;
  success: boolean;
  suggestions: string[];
}
