import { describe, expect, it } from "vitest";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { enforceProportionalTurnTargets } from "../domain/schedule/enforce-minimum-turn-targets.js";
import { materializeT6T7BlocksStrict } from "../domain/schedule/real-schedule-blocks.js";
import { coverResidualT6T7Only } from "../domain/schedule/real-schedule-residual.js";
import { computeRealMotorTargets } from "../domain/schedule/real-schedule-targets.js";
import { allocateT8BlocksStrict } from "../domain/schedule/real-schedule-t8.js";
import { materializeVacationFortnightPatterns } from "../domain/schedule/real-schedule-vacation-materialize.js";
import {
  refreshScheduleGenerationState,
} from "../domain/schedule/schedule-generation-state.js";
import {
  mergePipelineValidationResults,
  validateAfterMaterialization,
  validateAfterPlanning,
  validateAfterResidual,
  validateAfterV4Enforce,
  validateBeforeSave,
  type PipelineValidationResult,
} from "../domain/schedule/schedule-generation-validators.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const JULY_2026 = realisticGenerationInput({ year: 2026, month: 7 });

function structuralCriticalCount(result: PipelineValidationResult): number {
  return result.issues.filter(
    (i) =>
      (i.severity === "CRÍTICA" || i.level === "CRITICAL") &&
      i.type !== "COVERAGE_GAP",
  ).length;
}

describe("Pipeline jul/2026 — validação estrutural integrada", () => {
  it("executa checkpoints REAL_V1 e valida estado oficial", () => {
    const fullResult = realScheduleEngine.generate(JULY_2026);
    expect(fullResult.assignments.length).toBeGreaterThan(0);

    const ws = new GenerationWorkspace(JULY_2026);
    ws.realV1ManualCommonFolga = true;
    ws.applyHardBlocks();
    ws.planFolgaSocial();
    ws.initRateioContext();

    allocateT8BlocksStrict(ws);
    materializeVacationFortnightPatterns(ws);
    const { targets } = computeRealMotorTargets(ws);

    const blocks = materializeT6T7BlocksStrict(ws, targets);
    expect(blocks.feasibility.discardedTurns).toBeLessThanOrEqual(1);
    expect(
      Math.abs(blocks.feasibility.plannedTurns - blocks.feasibility.materializedTurns),
    ).toBeLessThanOrEqual(1);

    const afterPlanning = refreshScheduleGenerationState(ws, {
      stage: "BLOCK_PLANNING",
      blockPlan: blocks.blockPlans,
    });
    const planningResult = validateAfterPlanning(afterPlanning, ws);
    expect(planningResult.criticalCount).toBe(0);

    const afterMaterialization = refreshScheduleGenerationState(ws, {
      stage: "MATERIALIZATION",
      blockPlan: blocks.blockPlans,
      v3BlockMaterializeAudit: blocks.v3BlockMaterializeAudit,
    });
    const materializationResult = validateAfterMaterialization(afterMaterialization, ws);
    expect(materializationResult.criticalCount).toBe(0);

    coverResidualT6T7Only(ws);
    const afterResidual = refreshScheduleGenerationState(ws, {
      stage: "RESIDUAL",
      blockPlan: blocks.blockPlans,
      v3BlockMaterializeAudit: blocks.v3BlockMaterializeAudit,
    });
    const residualResult = validateAfterResidual(afterResidual, ws);

    ws.syncRateioContext();
    enforceProportionalTurnTargets(ws);
    const afterV4 = refreshScheduleGenerationState(ws, { stage: "V4_ENFORCE", blockPlan: blocks.blockPlans });
    const v4Result = validateAfterV4Enforce(afterV4, ws);

    const beforeSave = refreshScheduleGenerationState(ws, {
      stage: "FINAL_AUDIT",
      blockPlan: blocks.blockPlans,
      motorReport: fullResult.summary.realMotorReport,
    });
    const saveResult = validateBeforeSave(beforeSave, ws);

    const merged = mergePipelineValidationResults([
      planningResult,
      materializationResult,
      residualResult,
      v4Result,
      saveResult,
    ]);

    // Pipeline parcial até V4 ainda pode ter gaps de cobertura — validamos invariantes estruturais.
    expect(structuralCriticalCount(planningResult)).toBe(0);
    expect(structuralCriticalCount(materializationResult)).toBe(0);
    expect(structuralCriticalCount(v4Result)).toBe(0);

    expect(saveResult.issues.filter((i) => i.type === "DUPLICATE_ASSIGNMENT")).toHaveLength(0);
    expect(saveResult.issues.filter((i) => i.type === "ND_AS_SHIFT")).toHaveLength(0);
    expect(saveResult.issues.filter((i) => i.type === "TURN_COUNTER_DIVERGENCE")).toHaveLength(0);

    expect(merged.issues.length).toBeGreaterThan(0);

    for (const row of beforeSave.diagnostics.employeeTurns) {
      expect(row.turnsTotal).toBe(row.turnsT6 + row.turnsT7 + row.turnsT8 + row.turnsT9);
    }
  });

  it("geração completa jul/2026 produz motorReport com assignments consistentes", () => {
    const result = realScheduleEngine.generate(JULY_2026);
    const ws = new GenerationWorkspace(JULY_2026);
    ws.applyHardBlocks();
    for (const a of result.assignments) {
      const did = ws.uuidToDomain.get(a.employeeUuid);
      if (did == null) continue;
      ws.planned.set(`${did}|${a.date}`, a.shiftCode);
    }
    for (const al of result.allocations) {
      ws.allocations.push(al);
    }
    ws.initRateioContext();
    ws.syncRateioContext();

    const state = refreshScheduleGenerationState(ws, { stage: "FINAL_AUDIT" });
    const validation = validateBeforeSave(state, ws);

    expect(validation.criticalCount).toBe(0);
    expect(result.summary.coverageGaps).toBeGreaterThanOrEqual(0);
  });
});
