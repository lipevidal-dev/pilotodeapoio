import type { OperationalBalanceReport } from "./operational-balancer.js";
import type { ValidationIssue } from "./types.js";

export const PAO_SHIFTS_PER_DAY = 3;
export const NORMAL_CAPACITY_30 = 20;
export const NORMAL_CAPACITY_31 = 21;
export const VACATION_TARGET_30 = 9;
export const VACATION_TARGET_31 = 10;
export const FULL_NO_FLIGHT_TARGET = 20;
export const BLOCK_MIN_SIZE = 3;
export const BLOCK_IDEAL_SIZE = 4;
export const BLOCK_MAX_SIZE = 5;

export type PlanningGroup = "FULL_NO_FLIGHT" | "VACATION" | "NORMAL";

export interface OperationalDemand {
  daysInMonth: number;
  shiftsPerDay: number;
  totalDemand: number;
  perShift: Record<string, number>;
}

export interface EmployeeCapacity {
  employeeUuid: string;
  name: string;
  group: PlanningGroup;
  capacity: number;
  adjusted: boolean;
  detail: string;
}

export interface CapacitySummary {
  byEmployee: EmployeeCapacity[];
  totalCapacity: number;
}

export interface IndividualTarget {
  employeeUuid: string;
  name: string;
  group: PlanningGroup;
  seniority: number;
  target: number;
  capacity: number;
}

export interface PlannedBlock {
  size: number;
  shiftCode?: "T6" | "T7";
}

export interface ExecutedBlock {
  startDate: string;
  size: number;
  shiftCode: "T6" | "T7";
  endDate: string;
}

export interface EmployeeBlockPlan {
  employeeUuid: string;
  name: string;
  group: PlanningGroup;
  seniority: number;
  target: number;
  /** Bf — tamanho ideal do bloco (Motor V3). */
  idealBlockSize?: number;
  /** Zf — quantidade planejada de blocos (Motor V3). */
  plannedBlockCount?: number;
  /** Xf — espaçamento ideal entre blocos (Motor V3). */
  blockSpacing?: number;
  plannedBlocks: PlannedBlock[];
  executedBlocks: ExecutedBlock[];
}

export interface DemandPlanningReport {
  demand: OperationalDemand;
  capacity: CapacitySummary;
  operationalBalance: number;
  targets: IndividualTarget[];
  blockPlans: EmployeeBlockPlan[];
  averageBlockSize: number;
  unitCoverageBefore: number;
  unitCoverageApplied: number;
  unitCoverageAfter: number;
  balanceReport?: OperationalBalanceReport;
  warnings: ValidationIssue[];
  stepNotes: string[];
}
