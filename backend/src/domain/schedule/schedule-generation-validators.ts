import { auditStructuralT8 } from "./real-schedule-t8.js";
import { countRateioTurns, isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import { countWorkedDays } from "./real-schedule-workdays.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GenerationInput, GenerationResult, GeneratedAssignment } from "./generation-types.js";
import {
  buildWorkspaceFromGenerationResult,
  refreshScheduleGenerationState,
} from "./schedule-generation-state.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  currentTurnCount,
  type ScheduleRateioContext,
} from "./schedule-rateio-context.js";
import type { ScheduleGenerationState } from "./schedule-generation-state.js";
import type { ValidationIssue } from "./types.js";
import { assignmentKey } from "./types.js";
import {
  validateRateioMinimums,
  type RateioMinimumValidation,
} from "./enforce-minimum-turn-targets.js";

export interface PipelineValidationResult {
  stage: string;
  issues: ValidationIssue[];
  criticalCount: number;
}

function issue(
  type: string,
  detail: string,
  employee = "",
  date = "",
  severity: ValidationIssue["severity"] = "ALTA",
): ValidationIssue {
  return {
    severity,
    level: severity === "CRÍTICA" ? "CRITICAL" : severity === "ALTA" ? "WARNING" : "INFO",
    type,
    date,
    employee,
    detail,
  };
}

/** Verifica consistência turnos = T6+T7+T8+T9 entre grid e rateioContext. */
export function validateTurnCounterConsistency(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext | null,
): ValidationIssue[] {
  if (!ctx) {
    return [issue("RATEIO_CONTEXT_MISSING", "rateioContext ausente — sync obrigatório antes da validação")];
  }

  const issues: ValidationIssue[] = [];
  for (const c of ws.paoEmps) {
    const uuid = c.uuid;
    const fromGrid = countRateioTurns(ws, uuid);
    const fromCtx = currentTurnCount(ctx, uuid);
    const t6 = ctx.currentT6Counts.get(uuid) ?? 0;
    const t7 = ctx.currentT7Counts.get(uuid) ?? 0;
    const t8 = ctx.currentT8Counts.get(uuid) ?? 0;
    const t9 = ctx.currentT9Counts.get(uuid) ?? 0;
    const sumParts = t6 + t7 + t8 + t9;

    if (fromGrid !== fromCtx) {
      issues.push(
        issue(
          "TURN_COUNTER_DIVERGENCE",
          `grid=${fromGrid} ctx=${fromCtx} (T6=${t6} T7=${t7} T8=${t8} T9=${t9})`,
          c.employee.name,
        ),
      );
    }
    if (sumParts !== fromCtx) {
      issues.push(
        issue(
          "TURN_PARTS_SUM_MISMATCH",
          `soma partes=${sumParts} currentTurnCount=${fromCtx}`,
          c.employee.name,
        ),
      );
    }
  }
  return issues;
}

/** ND não deve aparecer como turno no grid nem incrementar contadores. */
export function validateNdNotCountedAsTurn(ws: GenerationWorkspace): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const a of ws.toAssignments()) {
    if (a.shiftCode.toUpperCase() === "ND") {
      issues.push(
        issue(
          "ND_AS_SHIFT",
          `ND encontrado em assignments (deve estar em allocations)`,
          a.employeeUuid,
          a.date,
          "CRÍTICA",
        ),
      );
    }
  }
  return issues;
}

/** Assignments duplicados na lista gerada (antes de reconstruir workspace). */
export function validateAssignmentListDuplicates(
  assignments: GeneratedAssignment[],
): ValidationIssue[] {
  const seen = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  for (const a of assignments) {
    const key = `${a.employeeUuid}|${a.date}`;
    const prev = seen.get(key);
    if (prev != null) {
      issues.push(
        issue(
          "DUPLICATE_ASSIGNMENT",
          `${prev} e ${a.shiftCode} no mesmo dia (lista gerada)`,
          a.employeeUuid,
          a.date,
          "CRÍTICA",
        ),
      );
    } else {
      seen.set(key, a.shiftCode);
    }
  }
  return issues;
}

/** ND não deve aparecer como shiftCode em assignments gerados. */
export function validateAssignmentListNoNd(
  assignments: GeneratedAssignment[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const a of assignments) {
    if (a.shiftCode.toUpperCase() === "ND") {
      issues.push(
        issue(
          "ND_AS_SHIFT",
          "ND na lista de assignments (deve estar em allocations)",
          a.employeeUuid,
          a.date,
          "CRÍTICA",
        ),
      );
    }
  }
  return issues;
}

/** Assignments duplicados: mesmo PAO + dia com turno no grid. */
export function validateNoDuplicateAssignments(ws: GenerationWorkspace): ValidationIssue[] {
  const seen = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  for (const a of ws.toAssignments()) {
    const key = `${a.employeeUuid}|${a.date}`;
    const prev = seen.get(key);
    if (prev != null) {
      issues.push(
        issue(
          "DUPLICATE_ASSIGNMENT",
          `${prev} e ${a.shiftCode} no mesmo dia`,
          a.employeeUuid,
          a.date,
          "CRÍTICA",
        ),
      );
    } else {
      seen.set(key, a.shiftCode);
    }
  }
  return issues;
}

/** Pré-alocações admin preservadas no grid. */
export function validatePreAllocationsPreserved(ws: GenerationWorkspace): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const lock of ws.input.lockedAllocations) {
    if (!ws.isLockedByAdmin(lock.employeeUuid, lock.date)) continue;
    const did = ws.uuidToDomain.get(lock.employeeUuid);
    if (did == null) continue;
    const shift = ws.planned.get(assignmentKey(did, lock.date));
    const label = normalizeOperationalLabel(lock.label).toUpperCase();
    const alloc = ws.allocations.find(
      (a) =>
        a.employeeUuid === lock.employeeUuid &&
        a.date === lock.date &&
        normalizeOperationalLabel(a.label).toUpperCase() === label,
    );
    const isShift = isRateioTurnShiftCode(label);
    if (isShift) {
      if (shift?.toUpperCase() !== label) {
        issues.push(
          issue(
            "PREALLOC_SHIFT_MISSING",
            `esperado ${label}, encontrado ${shift ?? "vazio"}`,
            lock.employeeUuid,
            lock.date,
            "CRÍTICA",
          ),
        );
      }
    } else if (!alloc) {
      issues.push(
        issue(
          "PREALLOC_ALLOC_MISSING",
          `esperado ${label}, encontrado vazio`,
          lock.employeeUuid,
          lock.date,
          "CRÍTICA",
        ),
      );
    }
  }
  return issues;
}

/** Cobertura T6/T7/T8 — gaps críticos. */
export function validateCoverage(state: ScheduleGenerationState): ValidationIssue[] {
  if (state.coverage.gapCount === 0) return [];
  return state.coverage.gaps.map((g) =>
    issue(
      "COVERAGE_GAP",
      `furo ${g.shiftCode}`,
      "",
      g.date,
      "CRÍTICA",
    ),
  );
}

/** T8/T8/ND estrutural. */
export function validateT8NdStructure(ws: GenerationWorkspace): ValidationIssue[] {
  const audit = auditStructuralT8(ws);
  const issues: ValidationIssue[] = [];
  if (audit.pairsWithoutNdCount > 0) {
    issues.push(
      issue(
        "T8_WITHOUT_ND",
        `${audit.pairsWithoutNdCount} par(es) T8/T8 sem ND`,
        "",
        "",
        "ALTA",
      ),
    );
  }
  return issues;
}

/** Min/target/max proporcional — receptores abaixo do mínimo. */
export function validateRateioMinimumIssues(
  ws: GenerationWorkspace,
): { validation: RateioMinimumValidation; issues: ValidationIssue[] } {
  const validation = validateRateioMinimums(ws);
  const issues: ValidationIssue[] = [];
  for (const row of validation.issues) {
    if (row.hasValidTransfer) {
      issues.push(
        issue(
          "RATEIO_MIN_UNENFORCED",
          `turnos=${row.current} min=${row.min}; transferência viável: ${row.transferHint ?? "?"}`,
          row.name,
          "",
          "CRÍTICA",
        ),
      );
    } else {
      issues.push(
        issue(
          "BELOW_PROPORTIONAL_MIN_JUSTIFIED",
          `turnos=${row.current} min=${row.min} (sem transferência viável)`,
          row.name,
          "",
          "ALTA",
        ),
      );
    }
  }
  return { validation, issues };
}

export function validateProportionalBounds(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext | null,
): ValidationIssue[] {
  if (!ctx) return [];
  const issues: ValidationIssue[] = [];
  for (const c of ws.paoEmps) {
    const uuid = c.uuid;
    const cur = currentTurnCount(ctx, uuid);
    const min = ctx.minTurnCounts.get(uuid);
    const max = ctx.maxTurnCounts.get(uuid);
    if (min != null && cur < min) {
      issues.push(
        issue(
          "BELOW_PROPORTIONAL_MIN",
          `turnos=${cur} min=${min}`,
          c.employee.name,
          "",
          "ALTA",
        ),
      );
    }
    if (max != null && cur > max && !ctx.overflowEvents.some((e) => e.includes(c.employee.name))) {
      issues.push(
        issue(
          "ABOVE_PROPORTIONAL_MAX",
          `turnos=${cur} max=${max} (sem overflow registrado)`,
          c.employee.name,
          "",
          "MÉDIA",
        ),
      );
    }
  }
  return issues;
}

/** Dias trabalhados devem incluir turnos rateio (nunca ser menores). */
export function validateWorkdaysSeparateFromTurns(ws: GenerationWorkspace): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const c of ws.paoEmps) {
    const uuid = c.uuid;
    const turns = countRateioTurns(ws, uuid);
    const workedDays = countWorkedDays(ws, uuid);
    if (workedDays < turns) {
      issues.push(
        issue(
          "TURNS_VS_WORKDAYS_MISMATCH",
          `countRateioTurns=${turns} countWorkedDays=${workedDays}`,
          c.employee.name,
        ),
      );
    }
  }
  return issues;
}

function runCommonValidations(
  ws: GenerationWorkspace,
  state: ScheduleGenerationState,
  includeCoverage: boolean,
): ValidationIssue[] {
  return [
    ...validateTurnCounterConsistency(ws, state.rateioContext),
    ...validateNdNotCountedAsTurn(ws),
    ...validateNoDuplicateAssignments(ws),
    ...validateWorkdaysSeparateFromTurns(ws),
    ...(includeCoverage ? validateCoverage(state) : []),
  ];
}

/** Após planejamento — blocos planejados vs metas, sem exigir cobertura completa. */
export function validateAfterPlanning(
  state: ScheduleGenerationState,
  ws: GenerationWorkspace,
): PipelineValidationResult {
  const issues: ValidationIssue[] = runCommonValidations(ws, state, false);

  if (!state.blockPlan || state.blockPlan.length === 0) {
    issues.push(issue("BLOCK_PLAN_EMPTY", "blockPlan ausente após etapa de planejamento"));
  } else {
    for (const plan of state.blockPlan) {
      const plannedShifts = plan.plannedBlocks.reduce((n, b) => n + b.size, 0);
      if (plannedShifts !== plan.target && plan.target > 2) {
        issues.push(
          issue(
            "BLOCK_PLAN_TARGET_MISMATCH",
            `planejado=${plannedShifts} target=${plan.target}`,
            plan.name,
          ),
        );
      }
    }
  }

  return finalize("AFTER_PLANNING", issues);
}

/** Após materialização V3 — audit blocos + contadores. */
export function validateAfterMaterialization(
  state: ScheduleGenerationState,
  ws: GenerationWorkspace,
): PipelineValidationResult {
  const issues: ValidationIssue[] = runCommonValidations(ws, state, false);

  const audit = state.diagnostics.v3BlockMaterializeAudit;
  if (audit) {
    for (const e of audit.employees) {
      if (e.discardedBlocks > 0) {
        issues.push(
          issue(
            "V3_BLOCKS_DISCARDED",
            `${e.discardedBlocks} bloco(s) descartado(s), ${e.discardedShifts} turno(s) — ver V3 audit`,
            e.employeeName,
            "",
            "MÉDIA",
          ),
        );
      }
      if (e.materializedShifts + e.discardedShifts !== e.plannedShifts) {
        issues.push(
          issue(
            "V3_SHIFT_ACCOUNTING",
            `plan=${e.plannedShifts} mat=${e.materializedShifts} desc=${e.discardedShifts}`,
            e.employeeName,
            "",
            "ALTA",
          ),
        );
      }
    }
  }

  issues.push(...validateT8NdStructure(ws));

  return finalize("AFTER_MATERIALIZATION", issues);
}

/** Após residual — cobertura parcial aceitável, contadores consistentes. */
export function validateAfterResidual(
  state: ScheduleGenerationState,
  ws: GenerationWorkspace,
): PipelineValidationResult {
  const issues: ValidationIssue[] = runCommonValidations(ws, state, true);
  issues.push(...validateT8NdStructure(ws));
  return finalize("AFTER_RESIDUAL", issues);
}

/** Após V4 enforce — bounds proporcionais + cobertura. */
export function validateAfterV4Enforce(
  state: ScheduleGenerationState,
  ws: GenerationWorkspace,
): PipelineValidationResult {
  const issues: ValidationIssue[] = runCommonValidations(ws, state, true);
  issues.push(...validateRateioMinimumIssues(ws).issues);
  issues.push(...validateProportionalBounds(ws, state.rateioContext));
  issues.push(...validateT8NdStructure(ws));
  return finalize("AFTER_V4_ENFORCE", issues);
}

/** Antes de persistir — validação completa incluindo pré-alocações. */
export function validateBeforeSave(
  state: ScheduleGenerationState,
  ws: GenerationWorkspace,
): PipelineValidationResult {
  const issues: ValidationIssue[] = runCommonValidations(ws, state, true);
  issues.push(...validatePreAllocationsPreserved(ws));
  issues.push(...validateRateioMinimumIssues(ws).issues);
  issues.push(...validateProportionalBounds(ws, state.rateioContext));
  issues.push(...validateT8NdStructure(ws));
  return finalize("BEFORE_SAVE", issues);
}

function finalize(stage: string, issues: ValidationIssue[]): PipelineValidationResult {
  const criticalCount = issues.filter(
    (i) => i.severity === "CRÍTICA" || i.level === "CRITICAL",
  ).length;
  return { stage, issues, criticalCount };
}

/**
 * Valida resultado do motor antes de persistir — reconstrói workspace e executa validateBeforeSave.
 */
export function validateGenerationBeforeSave(
  input: GenerationInput,
  result: GenerationResult,
): PipelineValidationResult {
  const listIssues = [
    ...validateAssignmentListNoNd(result.assignments),
    ...validateAssignmentListDuplicates(result.assignments),
  ];
  const ws = buildWorkspaceFromGenerationResult(input, result);
  const state = refreshScheduleGenerationState(ws, { stage: "PERSISTENCE" });
  const gridValidation = validateBeforeSave(state, ws);
  const issues = [...listIssues, ...gridValidation.issues];
  return finalize("BEFORE_SAVE", issues);
}

/** Agrega múltiplos resultados de checkpoint. */
export function mergePipelineValidationResults(
  results: PipelineValidationResult[],
): PipelineValidationResult {
  const issues = results.flatMap((r) => r.issues);
  return {
    stage: "MERGED",
    issues,
    criticalCount: issues.filter((i) => i.severity === "CRÍTICA" || i.level === "CRITICAL").length,
  };
}
