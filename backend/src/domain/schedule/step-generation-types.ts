import type { GeneratedAllocation, GeneratedAssignment } from "./generation-types.js";
import type { DemandPlanningReport } from "./demand-planning-types.js";
import type { ValidationIssue } from "./types.js";

export interface StepGenerationOptions {
  paoCheckPreAllocations: boolean;
  paoCheckRestrictions: boolean;
  /** Fase 7.3 — planejamento demanda → metas → blocos → escala */
  paoDemandPlanning: boolean;
  paoCoverageT6: boolean;
  paoCoverageT7: boolean;
  paoCoverageT8: boolean;
  paoAllocateFolgas: boolean;
  paoAllocateFlights: boolean;
  apaoCheckPreAllocations: boolean;
  apaoCheckShiftPreference: boolean;
  apaoCheckShiftRestrictions: boolean;
  apaoAllocate: boolean;
}

export const STEP_GENERATION_LABELS: Record<keyof StepGenerationOptions, string> = {
  paoCheckPreAllocations: "PAO — Verificar pré-alocações",
  paoCheckRestrictions: "PAO — Verificar restrições por funcionário",
  paoDemandPlanning: "PAO — Planejamento por demanda (Fase 7.3)",
  paoCoverageT6: "PAO — Alocar cobertura T6",
  paoCoverageT7: "PAO — Alocar cobertura T7",
  paoCoverageT8: "PAO — Alocar cobertura T8/T8/ND",
  paoAllocateFolgas: "PAO — Alocar folgas",
  paoAllocateFlights: "PAO — Alocar voos",
  apaoCheckPreAllocations: "APAO — Verificar pré-alocações",
  apaoCheckShiftPreference: "APAO — Verificar preferência por turnos",
  apaoCheckShiftRestrictions: "APAO — Verificar restrições de turnos",
  apaoAllocate: "APAO — Alocar turnos após cobertura PAO",
};

export interface BlockedEmployeeAudit {
  employee: string;
  employeeUuid: string;
  date: string;
  reason: string;
}

export interface CoverageDecisionAudit {
  date: string;
  shiftCode: string;
  selectedEmployee: string | null;
  selectedEmployeeUuid: string | null;
  selectionReasons: string[];
  blockedEmployees: Array<{ employee: string; reason: string }>;
}

export interface PaoCoverageAuditReport {
  fullMonthNoFlight: Array<{
    employeeUuid: string;
    employeeName: string;
    shiftCount: number;
    reached20: boolean;
    breakdown: Record<string, number>;
  }>;
  vacationPao: Array<{
    employeeUuid: string;
    employeeName: string;
    vacationDays: number;
    shiftsBeforeVacation: number;
    shiftsAfterVacation: number;
    totalOperationalShifts: number;
  }>;
  t6Blocks: { blockCount: number; averageBlockSize: number; unitCoverageCount: number };
  t7Blocks: { blockCount: number; averageBlockSize: number; unitCoverageCount: number };
  unitCoverageTotal: number;
  monoFolgas: {
    detected: number;
    corrected: number;
    kept: Array<{ employee: string; date: string; reason: string }>;
  };
}

export interface StepGenerationReport {
  mode: "AUDIT_PARTIAL";
  persisted: false;
  executedSteps: string[];
  skippedSteps: string[];
  allocationsByStep: Record<string, { assignments: number; allocations: number }>;
  blockedEmployees: BlockedEmployeeAudit[];
  coverageGaps: Array<{ date: string; shiftCode: string }>;
  coverageDecisions: CoverageDecisionAudit[];
  violations: ValidationIssue[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  selectionWarnings: string[];
  stepNotes: string[];
  paoCoverageAudit?: PaoCoverageAuditReport;
  demandPlanningReport?: DemandPlanningReport;
}

export interface StepGenerationResult {
  year: number;
  month: number;
  mode: "AUDIT_PARTIAL";
  persisted: false;
  assignments: GeneratedAssignment[];
  allocations: GeneratedAllocation[];
  report: StepGenerationReport;
}

export function listSelectedSteps(options: StepGenerationOptions): (keyof StepGenerationOptions)[] {
  return (Object.keys(STEP_GENERATION_LABELS) as (keyof StepGenerationOptions)[]).filter(
    (key) => options[key],
  );
}

export function listSkippedSteps(options: StepGenerationOptions): (keyof StepGenerationOptions)[] {
  return (Object.keys(STEP_GENERATION_LABELS) as (keyof StepGenerationOptions)[]).filter(
    (key) => !options[key],
  );
}
