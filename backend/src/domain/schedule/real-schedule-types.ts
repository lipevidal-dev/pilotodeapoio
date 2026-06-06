import type { OperationalBalanceReport } from "./operational-balancer.js";
import type { IndividualTarget } from "./demand-planning-types.js";
import type { OperationalDemand } from "./demand-planning-types.js";
import type { ValidationIssue } from "./types.js";
import type { RealStructuralMetrics } from "./real-schedule-audit.js";
import type { VacationFortnightBelowPattern } from "./real-schedule-vacation-materialize.js";

export const MOTOR_VERSION_ID = "REAL_V1";
export const ENGINE_PATH = "GenerateScheduleUseCase -> RealScheduleEngine";
export const MOTOR_REAL_V1_LABEL = "Motor real v1 — demanda/metas/blocos/voos";
export const MONTHLY_WORKDAY_TARGET = 20;
export const MIN_MONTHLY_FOLGAS = 10;
export const FLEXIBLE_SHIFT_SHORTFALL = 3;

export interface WorkdayBreakdown {
  turnosT6: number;
  turnosT7: number;
  turnosT8: number;
  voos: number;
  cursos: number;
  simuladores: number;
  cma: number;
  outros: number;
  /** Turnos + voos + cadastros úteis (ND não conta). */
  total: number;
}

export interface RequiredShiftsResult {
  employeeUuid: string;
  name: string;
  group: "FULL_NO_FLIGHT" | "VACATION" | "NORMAL";
  workTarget: number;
  requiredT6T7: number;
  breakdown: WorkdayBreakdown;
  note?: string;
}

export interface EmployeeDiagnostic {
  employeeUuid: string;
  name: string;
  targetWorkdays: number;
  actualWorkdays: number;
  neededTurns: number;
  noFlightFullMonth: boolean;
  restrictedShiftIds: string[];
  restrictedShiftCodes: string[];
  t6Count: number;
  t7Count: number;
  t8Count: number;
  flightCount: number;
  usefulOperationalDays: number;
  requiredT6T7: number;
  failedAllocationReasons: string[];
}

export interface RealMotorReport {
  motorVersion: typeof MOTOR_VERSION_ID;
  demand: OperationalDemand;
  requiredShifts: RequiredShiftsResult[];
  targets: IndividualTarget[];
  employeeDiagnostics?: EmployeeDiagnostic[];
  t8BlocksPlaced: number;
  t8CoverageGaps: number;
  t8IsolatedCount: number;
  t8PairsWithoutNdCount: number;
  vacationFortnightProcessed: number;
  vacationBelowPattern: VacationFortnightBelowPattern[];
  t6T7BlocksPlaced: number;
  t6T7ShiftsPlaced: number;
  residualBlockCoverage: number;
  residualUnitCoverage: number;
  structuralMetrics?: RealStructuralMetrics;
  flightsForDeficit: number;
  balanceReport?: OperationalBalanceReport;
  stepNotes: string[];
  warnings: ValidationIssue[];
}
