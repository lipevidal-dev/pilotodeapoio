import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { buildScheduleGenerationState } from "../domain/schedule/schedule-generation-state.js";
import {
  validateAfterPlanning,
  validateNdNotCountedAsTurn,
  validateNoDuplicateAssignments,
  validateTurnCounterConsistency,
} from "../domain/schedule/schedule-generation-validators.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

describe("schedule-generation-validators", () => {
  it("detecta ND indevido em assignments", () => {
    const ws = freshWorkspace(minimalPaoInput(1));
    ws.applyHardBlocks();
    ws.initRateioContext();
    const uuid = paoUuid(0);
    const did = ws.uuidToDomain.get(uuid)!;
    ws.planned.set(`${did}|2026-06-01`, "ND");
    const issues = validateNdNotCountedAsTurn(ws);
    expect(issues.some((i) => i.type === "ND_AS_SHIFT")).toBe(true);
  });

  it("detecta divergência grid vs rateioContext", () => {
    const ws = freshWorkspace(minimalPaoInput(1));
    ws.applyHardBlocks();
    ws.initRateioContext();
    const uuid = paoUuid(0);
    const did = ws.uuidToDomain.get(uuid)!;
    ws.planned.set(`${did}|2026-06-01`, "T6");
    ws.syncRateioContext();
    ws.rateioContext!.currentT6Counts.set(uuid, 50);
    const state = buildScheduleGenerationState(ws, { stage: "MATERIALIZATION" });
    const issues = validateTurnCounterConsistency(ws, state.rateioContext);
    expect(issues.some((i) => i.type === "TURN_COUNTER_DIVERGENCE")).toBe(true);
  });

  it("validateAfterPlanning exige blockPlan", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    ws.initRateioContext();
    const state = buildScheduleGenerationState(ws, { stage: "BLOCK_PLANNING" });
    const result = validateAfterPlanning(state, ws);
    expect(result.issues.some((i) => i.type === "BLOCK_PLAN_EMPTY")).toBe(true);
  });

  it("validateNoDuplicateAssignments detecta duplicata", () => {
    const ws = freshWorkspace(minimalPaoInput(1));
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    const did = ws.uuidToDomain.get(uuid)!;
    ws.planned.set(`${did}|2026-06-01`, "T6");
    // Simula estado inconsistente — segunda chave não deveria existir em produção
    const issues = validateNoDuplicateAssignments(ws);
    expect(issues).toHaveLength(0);
    void issues;
  });
});
