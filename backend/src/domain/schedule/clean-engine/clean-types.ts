import type { GenerationInput, GenerationInputEmployee } from "../generation-types.js";
import type { ValidationIssue } from "../types.js";

export type CleanDecisionKind =
  | "APPLY_LOCKED"
  | "APPLY_VACATION"
  | "APPLY_DAY_OFF"
  | "APPLY_FLIGHT"
  | "COVERAGE_ATTEMPT"
  | "COVERAGE_ASSIGNED"
  | "COVERAGE_FAILED"
  | "T8_ND_REQUIRED"
  | "T8_ND_APPLIED"
  | "T8_ND_BLOCKED"
  | "SKIP_ALREADY_COVERED"
  | "FCF_SHIFT_NOT_APPLIED"
  | "PREFERRED_META_REACHED";

export interface CleanAuditEntry {
  kind: CleanDecisionKind;
  date: string;
  shiftCode?: string;
  employeeUuid?: string;
  employeeName?: string;
  reason: string;
  phase: string;
}

export interface CleanEngineOptions {
  /** Turnos rateio que o motor pode alocar (T6–T9). Ausente = todos os ativos. */
  allowedShiftCodes?: string[];
  /** Turnos de cobertura obrigatória (cadastrados). Padrão: T6, T7, T8 ativos PAO/BOTH REQUIRED. */
  coverageShiftCodes?: string[];
  /** null = todos os PAOs; array = somente estes UUIDs recebem alocação. */
  scopeEmployeeUuids?: string[] | null;
  /** Regras ativas do motor NEXT — ausente = todas ligadas. */
  enabledRules?: Record<string, boolean>;
  /** Metas numéricas configuradas (referência / fases futuras). */
  motorParams?: Record<string, number>;
  /** Identificador reportado no summary. */
  motorVersion?: string;
}

export interface CleanEngineState {
  input: GenerationInput;
  paoEmployees: GenerationInputEmployee[];
  audit: CleanAuditEntry[];
  violations: ValidationIssue[];
  suggestions: string[];
}

export interface CleanValidationResult {
  stage: string;
  issues: ValidationIssue[];
  criticalCount: number;
}

export const RATEIO_TURN_CODES = ["T6", "T7", "T8", "T9"] as const;

export function isRateioTurnCode(code: string): boolean {
  return (RATEIO_TURN_CODES as readonly string[]).includes(code.toUpperCase());
}
