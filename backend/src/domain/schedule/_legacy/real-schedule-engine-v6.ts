import { validateSchedule } from "../../rules/engine.js";
import { runFinalCoverageGate } from "../../rules/coverage-gate.js";
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
import {
  validateRateioMinimums,
} from "./enforce-minimum-turn-targets.js";
import { materializeVacationFortnightPatterns } from "./real-schedule-vacation-materialize.js";
import { allocateParallelShifts } from "./real-schedule-parallel.js";
import {
  ENGINE_PATH_V6,
  MOTOR_V6_LABEL,
  MOTOR_VERSION_V6,
} from "./real-schedule-types.js";
import type { GenerationInput, GenerationResult } from "../generation-types.js";
import type { ValidationIssue } from "../types.js";
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

export class RealScheduleEngineV6 {
  generate(input: GenerationInput): GenerationResult {
    const startedAt = performance.now();
    const ws = new GenerationWorkspace(input);
    ws.realV1ManualCommonFolga = true;
    ws.v5RepairPreferenceStrict = true;
    ws.persistenceFocusTraceEnabled = false;
    clearV5PreferredPhaseTracking(ws);
    clearV5RepairPreferenceAudit(ws);
    clearV5FillPreferenceAudit(ws);
    clearV5PreferenceLockTracking(ws);
    clearV55MinimumOpportunityAudit(ws);
    clearV56MinimumLockAudit(ws);

    const warnings: ValidationIssue[] = [];
    const stepNotes: string[] = [];
    const preferenceCheckpoints: PreferenceCheckpoint[] = [];
    stepNotes.push(`[V6] ${MOTOR_V6_LABEL}`);

    ws.enforceMonthStart6x1FromPrevious();
    ws.applyHardBlocks();
    applyFaniFollowingFolga(ws, warnings);
    applySpecificShiftRequests(ws, warnings);
    ws.planFolgaSocial();

    const vacation = materializeVacationFortnightPatterns(ws);
    warnings.push(...vacation.warnings);
    stepNotes.push(
      `[V6-1] Pré-alocações e férias: ${vacation.processedCount} PAO(s) em padrão quinzenal.`,
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

    setV5PipelineStage(ws, "fill_complementary");
    v5FillRemainingQuotaWithAnyAllowedShift(ws, warnings);
    ws.syncRateioContext();
    stepNotes.push(formatV5FillPreferenceDilutionAudit(ws));

    setV5PipelineStage(ws, "allocate_parallel");
    const parallel = allocateParallelShifts(ws);
    stepNotes.push(`[V6-2] Paralelos=${parallel.parallelShiftsAllocated}.`);

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
    }

    setV5PipelineStage(ws, "v57_post_lock_coverage");
    const postLock = runV57PostLockCoverage(ws);
    stepNotes.push(...postLock.notes);
    warnings.push(...postLock.warnings);
    stepNotes.push(formatV57GuardsAudit(ws));

    applySpecificShiftRequests(ws, warnings);
    ws.correctMonoFolgasPedidas();
    ws.ensureMinShiftsForFullMonthNoFlight();

    const postAudit = buildV5QuotaAudit(ws);
    stepNotes.push(formatV5QuotaAudit(postAudit));

    const coverageGaps = ws.listCoverageGaps().length;
    preferenceCheckpoints.push(
      capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "final"),
    );
    stepNotes.push(formatPreferenceRepairTraceReport(preferenceCheckpoints, {
      focusNames: ["Davi", "Gustavo", "Alexandre", "Lucas", "Palombino", "Antonio"],
    }));

    const preSaveRepair = repairCoverageGapsBeforeSave(ws);
    warnings.push(...preSaveRepair.warnings);
    applySpecificShiftRequests(ws, warnings);
    ws.clearCoverageGapsCache();

    const assignments = ws.toAssignments();
    const scheduleCtx = ws.toScheduleContext();
    const engineViolations = validateSchedule(scheduleCtx);
    const gate = runFinalCoverageGate(scheduleCtx);
    const gapViolations = validateNoCoverageGaps(ws);
    validateRateioMinimums(ws);

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
      impossibleScenario: false,
      mainBlockingReasons: [],
      motorVersion: MOTOR_VERSION_V6,
      enginePath: ENGINE_PATH_V6,
      realEngineExecuted: true,
      realMotorReport: {
        motorVersion: MOTOR_VERSION_V6,
        stepNotes,
        warnings,
        v5QuotaAudit: postAudit,
        v5PreferenceCheckpoints: preferenceCheckpoints,
        saveValidationCritical: violations.filter((v) => v.level === "CRITICAL").length,
      },
    });

    return {
      assignments,
      allocations: ws.allocations,
      violations,
      summary,
      success: summary.valid,
      suggestions: [],
    };
  }
}

export const realScheduleEngineV6 = new RealScheduleEngineV6();
