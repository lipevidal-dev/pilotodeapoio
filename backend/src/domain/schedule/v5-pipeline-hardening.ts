import { deduplicatePaoShiftCoverage } from "./pao-shift-dedup.js";
import { enforceMinimumTurnTargets } from "./enforce-minimum-turn-targets.js";
import { optimizeEmergencyIsolatedT8 } from "./optimize-emergency-isolated-t8.js";
import {
  repairAllCoverageGapsFinal,
  validateNoCoverageGaps,
} from "./repair-all-coverage-gaps-final.js";
import { finalizeT8NdBlocks } from "./schedule-grid-source.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { setV5PipelineStage } from "./v5-preferred-phase-guard.js";
import {
  formatV58NoIsolatedShiftAudit,
  listInvalidV58WorkBlocks,
  repairIsolatedWorkBlocks,
} from "./v5-work-block-quality.js";
import {
  captureOptimizationSnapshot,
  restoreOptimizationSnapshot,
} from "./workspace-optimization-transaction.js";
import type { ValidationIssue } from "./types.js";

export interface V57PostLockCoverageReport {
  notes: string[];
  warnings: ValidationIssue[];
  gapsRemaining: number;
}

/**
 * V5.7 — pipeline pós-lock enxuto (substitui runFinalCoveragePipeline no V5).
 * Uma passagem de dedup/repair, T8 optimize opcional com rollback, enforce mínimo 1×.
 */
export function runV57PostLockCoverage(ws: GenerationWorkspace): V57PostLockCoverageReport {
  const notes: string[] = [];
  const warnings: ValidationIssue[] = [];
  const ctx = ws.ensureRateioContext();

  setV5PipelineStage(ws, "v57_post_lock_coverage");
  finalizeT8NdBlocks(ws);
  const dupes = deduplicatePaoShiftCoverage(ws);

  let repair = {
    t6Filled: 0,
    t7Filled: 0,
    t8BlocksPlaced: 0,
    t8EmergencyIsolated: 0,
    warnings: [] as ValidationIssue[],
  };

  if (ws.listCoverageGaps().length > 0) {
    repair = repairAllCoverageGapsFinal(ws, ctx);
    warnings.push(...repair.warnings);
    finalizeT8NdBlocks(ws);
    deduplicatePaoShiftCoverage(ws);
  }

  const preOptimize = captureOptimizationSnapshot(ws);
  const t8Opt = optimizeEmergencyIsolatedT8(ws, ctx);

  if (t8Opt.converted > 0 && !t8Opt.rolledBack) {
    finalizeT8NdBlocks(ws);
    deduplicatePaoShiftCoverage(ws);
    if (ws.listCoverageGaps().length > 0) {
      const postOpt = repairAllCoverageGapsFinal(ws, ctx);
      warnings.push(...postOpt.warnings);
      repair = {
        t6Filled: repair.t6Filled + postOpt.t6Filled,
        t7Filled: repair.t7Filled + postOpt.t7Filled,
        t8BlocksPlaced: repair.t8BlocksPlaced + postOpt.t8BlocksPlaced,
        t8EmergencyIsolated: repair.t8EmergencyIsolated + postOpt.t8EmergencyIsolated,
        warnings: repair.warnings,
      };
    }

    if (validateNoCoverageGaps(ws).length > 0) {
      restoreOptimizationSnapshot(ws, preOptimize);
      finalizeT8NdBlocks(ws);
      deduplicatePaoShiftCoverage(ws);
      notes.push("[V5.7] Otimização T8 revertida — gaps persistiram.");
    } else {
      notes.push(
        `[V5.7] T8 isolado: ${t8Opt.isolatedBefore}→${t8Opt.isolatedAfter} (${t8Opt.converted} convertido(s)).`,
      );
    }
  }

  ws.syncRateioContext();
  setV5PipelineStage(ws, "v57_enforce_min_once");
  const minEnforce = enforceMinimumTurnTargets(ws);

  setV5PipelineStage(ws, "v58_work_block_quality");
  const invalidBefore = listInvalidV58WorkBlocks(ws).length;
  const v58Repair = repairIsolatedWorkBlocks(ws, ctx);
  notes.push(
    `[V5.8] Pós-enforce blocos inválidos: ${invalidBefore}→${v58Repair.invalidAfter} ` +
      `(corrigidos=${v58Repair.fixed}, críticos=${v58Repair.criticalRemaining}).`,
  );
  notes.push(formatV58NoIsolatedShiftAudit(ws));

  const gapsRemaining = ws.listCoverageGaps().length;
  notes.push(
    `[V5.7] Pós-lock: dedup=${dupes}; repair T6=${repair.t6Filled} T7=${repair.t7Filled} ` +
      `T8=${repair.t8BlocksPlaced}+${repair.t8EmergencyIsolated}; ` +
      `enforce min transf=${minEnforce.transfers} abaixo_min=${minEnforce.belowMinBefore}→${minEnforce.belowMinAfter}; ` +
      `gaps=${gapsRemaining}.`,
  );

  return { notes, warnings, gapsRemaining };
}
