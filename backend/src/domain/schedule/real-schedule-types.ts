import type { OperationalBalanceReport } from "./operational-balancer.js";
import type { IndividualTarget } from "./demand-planning-types.js";
import type { OperationalDemand } from "./demand-planning-types.js";
import type { ValidationIssue } from "./types.js";

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

export interface RealMotorReport {
  motorVersion: typeof MOTOR_VERSION_ID;
  demand: OperationalDemand;
  requiredShifts: RequiredShiftsResult[];
  targets: IndividualTarget[];
  t8BlocksPlaced: number;
  t6T7BlocksPlaced: number;
  t6T7ShiftsPlaced: number;
  residualUnitCoverage: number;
  flightsForDeficit: number;
  balanceReport?: OperationalBalanceReport;
  stepNotes: string[];
  warnings: ValidationIssue[];
}
