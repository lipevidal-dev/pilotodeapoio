import { validateSchedule } from "../rules/engine.js";
import { runFinalCoverageGate } from "../rules/coverage-gate.js";
import { buildGenerationInsights } from "./generation-insights.js";
import { buildExtendedSummary } from "./generation-summary.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { deduplicatePaoShiftCoverage } from "./pao-shift-dedup.js";
import {
  repairAllCoverageGapsFinal,
  repairCoverageGapsBeforeSave,
  validateNoCoverageGaps,
} from "./repair-all-coverage-gaps-final.js";
import {
  finalizeT8NdBlocks,
  finalizeT8NdBlocksForV5PreRepair,
} from "./schedule-grid-source.js";
import { validateRateioMinimums } from "./enforce-minimum-turn-targets.js";
import { materializeVacationFortnightPatterns } from "./real-schedule-vacation-materialize.js";
import { allocateParallelShifts } from "./real-schedule-parallel.js";
import {
  ENGINE_PATH_V5,
  MOTOR_V5_LABEL,
  MOTOR_VERSION_V5,
} from "./real-schedule-types.js";
import type { GenerationInput, GenerationResult } from "./generation-types.js";
import type { ValidationIssue } from "./types.js";
import {
  v5AllocatePreferredTurnsBySeniority,
  v5FillRemainingQuotaWithAnyAllowedShift,
} from "./v5-quota-allocation.js";
import {
  applyFaniFollowingFolga,
  applySpecificShiftRequests,
  buildV5QuotaAudit,
  formatV5QuotaAudit,
} from "./v5-audit.js";
import {
  capturePreferenceCheckpoint,
  formatPreferenceRepairTraceReport,
  type PreferenceCheckpoint,
} from "./preference-repair-impact-audit.js";
import {
  clearV5PreferredPhaseTracking,
  formatInterPhasePreferredRemovalAudit,
  setV5PipelineStage,
} from "./v5-preferred-phase-guard.js";
import {
  clearV5FillPreferenceAudit,
  formatV5FillPreferenceDilutionAudit,
} from "./v5-fill-preference.js";
import {
  clearV5RepairPreferenceAudit,
  formatV5RepairPreferenceDilutionAudit,
} from "./v5-repair-preference.js";
import {
  clearV5RepairPreferenceSwapAudit,
  formatV5RepairPreferenceSwapAudit,
  runV5RepairPreferenceSwap,
} from "./v5-repair-preference-swap.js";
import {
  applyV5PreferenceLockFromCheckpoint,
  clearV5PreferenceLockTracking,
  formatV5PreferenceLockAudit,
} from "./v5-preference-lock-final.js";
import {
  clearV55MinimumOpportunityAudit,
  formatV55MinimumOpportunityAudit,
  minimumOpportunityFill,
} from "./v5-minimum-opportunity-fill.js";
import { clearV56MinimumLockAudit } from "./v5-minimum-lock.js";
import { formatV57GuardsAudit } from "./v5-assignment-guards.js";
import { runV57PostLockCoverage } from "./v5-pipeline-hardening.js";

export class RealScheduleEngineV5 {
  generate(input: GenerationInput): GenerationResult {
    const startedAt = performance.now();
    const ws = new GenerationWorkspace(input);
    ws.realV1ManualCommonFolga = true;
    ws.v5RepairPreferenceStrict = true;
    ws.persistenceFocusTraceEnabled = false;
    clearV5PreferredPhaseTracking(ws);
    clearV5RepairPreferenceAudit(ws);
    clearV5FillPreferenceAudit(ws);
    clearV5RepairPreferenceSwapAudit(ws);
    clearV5PreferenceLockTracking(ws);
    clearV55MinimumOpportunityAudit(ws);
    clearV56MinimumLockAudit(ws);

    const warnings: ValidationIssue[] = [];
    const stepNotes: string[] = [];
    const preferenceCheckpoints: PreferenceCheckpoint[] = [];
    stepNotes.push(`[V5] ${MOTOR_V5_LABEL}`);

    ws.enforceMonthStart6x1FromPrevious();
    ws.applyHardBlocks();
    applyFaniFollowingFolga(ws, warnings);
    applySpecificShiftRequests(ws, warnings);
    ws.planFolgaSocial();

    const vacation = materializeVacationFortnightPatterns(ws);
    warnings.push(...vacation.warnings);
    stepNotes.push(
      `[V5-1] Pré-alocações e férias: ${vacation.processedCount} PAO(s) em padrão quinzenal.`,
    );

    ws.initRateioContext();
    applySpecificShiftRequests(ws, warnings);

    const preAudit = buildV5QuotaAudit(ws);
    stepNotes.push(formatV5QuotaAudit(preAudit));

    setV5PipelineStage(ws, "after_preferred_phase");
    v5AllocatePreferredTurnsBySeniority(ws, warnings);
    ws.syncRateioContext();
    preferenceCheckpoints.push(
      capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "after_preferred_phase"),
    );
    stepNotes.push("[V5-2a] Fase preferida por senioridade concluída.");

    setV5PipelineStage(ws, "fill_complementary");
    v5FillRemainingQuotaWithAnyAllowedShift(ws, warnings);
    ws.syncRateioContext();
    stepNotes.push(formatV5FillPreferenceDilutionAudit(ws));

    setV5PipelineStage(ws, "allocate_parallel");
    const parallel = allocateParallelShifts(ws);
    stepNotes.push(
      `[V5-2b] Cota complementar + paralelos=${parallel.parallelShiftsAllocated}.`,
    );

    setV5PipelineStage(ws, "finalize_t8_nd");
    ws.reconcileNdAfterParallelShifts();
    finalizeT8NdBlocksForV5PreRepair(ws);

    stepNotes.push(formatInterPhasePreferredRemovalAudit(ws));

    const ctx = ws.ensureRateioContext();
    preferenceCheckpoints.push(
      capturePreferenceCheckpoint(ws, ctx, "before_repair_gaps_final"),
    );

    setV5PipelineStage(ws, "v55_minimum_opportunity_fill");
    clearV55MinimumOpportunityAudit(ws);
    const v55Fill = minimumOpportunityFill(ws, warnings);
    ws.syncRateioContext();
    stepNotes.push(formatV55MinimumOpportunityAudit(ws));
    stepNotes.push(
      `[V5.5] Minimum opportunity fill: tentativas=${v55Fill.totalAttempts} ` +
        `aceitas=${v55Fill.totalAccepted} PAOs=${v55Fill.employeesHelped} ` +
        `ainda_abaixo_min=${v55Fill.stillBelowMin}.`,
    );

    ws.v56MinimumLockEnabled = true;

    setV5PipelineStage(ws, "repair_gaps_final");
    let repair = repairAllCoverageGapsFinal(ws, ctx);
    finalizeT8NdBlocksForV5PreRepair(ws);
    deduplicatePaoShiftCoverage(ws);
    if (ws.listCoverageGaps().length > 0) {
      repair = repairAllCoverageGapsFinal(ws, ctx);
      finalizeT8NdBlocks(ws);
    }
    stepNotes.push(formatV5RepairPreferenceDilutionAudit(ws));
    preferenceCheckpoints.push(
      capturePreferenceCheckpoint(ws, ctx, "after_repair_gaps_final_v5"),
    );
    warnings.push(...repair.warnings);

    const beforeRepairCheckpoint = preferenceCheckpoints.find(
      (c) => c.label === "before_repair_gaps_final",
    );
    if (beforeRepairCheckpoint) {
      applyV5PreferenceLockFromCheckpoint(ws, beforeRepairCheckpoint);
      stepNotes.push(formatV5PreferenceLockAudit(ws));
      stepNotes.push("[V5-4] Preference lock final aplicado antes do pipeline de cobertura.");
    }

    setV5PipelineStage(ws, "v57_post_lock_coverage");
    const postLock = runV57PostLockCoverage(ws);
    stepNotes.push(...postLock.notes);
    warnings.push(...postLock.warnings);

    setV5PipelineStage(ws, "repair_preference_swap");
    const swap = runV5RepairPreferenceSwap(ws, warnings);
    stepNotes.push(
      `[V5.7] Swap preferencial pós-lock: ${swap.swapsApplied} troca(s); gaps=${swap.gapsAfter}.`,
    );
    stepNotes.push(formatV5RepairPreferenceSwapAudit(ws));

    preferenceCheckpoints.push(
      capturePreferenceCheckpoint(ws, ctx, "after_final_coverage_pipeline"),
    );

    applySpecificShiftRequests(ws, warnings);

    ws.correctMonoFolgasPedidas();
    ws.ensureMinShiftsForFullMonthNoFlight();

    const postAudit = buildV5QuotaAudit(ws);
    stepNotes.push(formatV5QuotaAudit(postAudit));

    const coverageGaps = ws.listCoverageGaps().length;
    stepNotes.push(
      `[V5-3] Cobertura final: gaps=${coverageGaps}; T6=${repair.t6Filled} T7=${repair.t7Filled} ` +
        `T8 blocos=${repair.t8BlocksPlaced} T8 emerg=${repair.t8EmergencyIsolated}.`,
    );

    const preSaveRepair = repairCoverageGapsBeforeSave(ws);
    if (preSaveRepair.warnings.length > 0) {
      warnings.push(...preSaveRepair.warnings);
    }

    applySpecificShiftRequests(ws, warnings);

    ws.clearCoverageGapsCache();
    stepNotes.push(formatV57GuardsAudit(ws));

    preferenceCheckpoints.push(
      capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "final"),
    );

    const preferenceRepairTrace = formatPreferenceRepairTraceReport(preferenceCheckpoints, {
      focusNames: ["Davi", "Gustavo", "Alexandre", "Lucas", "Palombino", "Antonio"],
    });
    stepNotes.push(preferenceRepairTrace);

    const assignments = ws.toAssignments();
    const scheduleCtx = ws.toScheduleContext();
    const engineViolations = validateSchedule(scheduleCtx);
    const gate = runFinalCoverageGate(scheduleCtx);
    const gapViolations = validateNoCoverageGaps(ws);
    const rateioMin = validateRateioMinimums(ws);

    if (rateioMin.issues.some((i) => i.hasValidTransfer)) {
      warnings.push({
        severity: "MÉDIA",
        level: "WARNING",
        type: "V5_RATEIO_MIN_PENDING",
        date: "",
        employee: rateioMin.issues.map((i) => i.name).join(", "),
        detail: "Mínimo proporcional não atingido com transferência viável.",
      });
    }

    const seen = new Set<string>();
    const violations = [
      ...ws.birthdayWarnings,
      ...ws.noFlightWarnings,
      ...ws.monoFolgaWarnings,
      ...warnings,
      ...engineViolations,
      ...gate.issues,
      ...gapViolations,
    ].filter((i) => {
      const k = `${i.type}|${i.date}|${i.employee}|${i.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const folgasPerPao: Record<string, number> = {};
    for (const c of ws.paoEmps) {
      folgasPerPao[c.employee.name] = ws.countRest(c.uuid);
    }

    const engineSuggestions = [...stepNotes];
    if (coverageGaps > 0) {
      engineSuggestions.push(`${coverageGaps} furo(s) de cobertura — revise equipe e bloqueios.`);
    }

    const saveValidationCritical = violations.filter((v) => v.level === "CRITICAL").length;

    const insights = buildGenerationInsights(
      ws,
      violations,
      { repaired: repair.t6Filled + repair.t7Filled, remainingGaps: coverageGaps, suggestions: [] },
      engineSuggestions,
    );

    const generationMs = Math.round(performance.now() - startedAt);
    const summary = buildExtendedSummary(ws, violations, {
      totalAssignments: assignments.length,
      totalAllocations: ws.allocations.length,
      paoCount: ws.paoEmps.length,
      apaoCount: ws.apaoEmps.length,
      folgasPerPao,
      coverageGaps,
      repairsApplied: repair.t6Filled + repair.t7Filled + repair.t8BlocksPlaced,
      repairRemainingGaps: coverageGaps,
      generationMs,
      impossibleScenario: insights.impossibleScenario,
      mainBlockingReasons: insights.mainBlockingReasons,
      motorVersion: MOTOR_VERSION_V5,
      enginePath: ENGINE_PATH_V5,
      realEngineExecuted: true,
      realMotorReport: {
        motorVersion: MOTOR_VERSION_V5,
        stepNotes,
        warnings,
        v5QuotaAudit: postAudit,
        v5PreferenceCheckpoints: preferenceCheckpoints,
        saveValidationCritical,
      },
    });

    return {
      assignments,
      allocations: ws.allocations,
      violations,
      summary,
      success: summary.valid,
      suggestions: insights.suggestions,
    };
  }
}

export const realScheduleEngineV5 = new RealScheduleEngineV5();
