import { describe, expect, it } from "vitest";
import { buildFeasibleBlockPlans, simulateBlockPlacement, sumPlannedTurns } from "../domain/schedule/v3-feasibility-planning.js";
import { materializeT6T7BlocksStrict } from "../domain/schedule/real-schedule-blocks.js";
import { computeRealMotorTargets } from "../domain/schedule/real-schedule-targets.js";
import { allocateT8BlocksStrict } from "../domain/schedule/real-schedule-t8.js";
import { materializeVacationFortnightPatterns } from "../domain/schedule/real-schedule-vacation-materialize.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { IndividualTarget } from "../domain/schedule/demand-planning-types.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

function makeTarget(uuid: string, name: string, target: number): IndividualTarget {
  return {
    employeeUuid: uuid,
    name,
    group: "NORMAL",
    seniority: 1,
    target,
    capacity: target,
  };
}

describe("V3 Feasibility Planning", () => {
  it("simulateBlockPlacement rejeita bloco em calendário fragmentado", () => {
    const ws = freshWorkspace(minimalPaoInput(1));
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    for (const day of ws.days) {
      if (day.endsWith("-01") || day.endsWith("-02") || day.endsWith("-04") || day.endsWith("-05")) {
        ws.lockDay(uuid, day, "FOLGA", false);
      }
    }
    const start = ws.days[0]!;
    expect(simulateBlockPlacement(ws, uuid, start, 4)).toBe(false);
  });

  it("buildFeasibleBlockPlans só inclui blocos com startDate viável", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    const targets = [makeTarget(paoUuid(0), "PAO-A", 8), makeTarget(paoUuid(1), "PAO-B", 8)];
    const plans = buildFeasibleBlockPlans(ws, targets);

    for (const plan of plans) {
      for (const block of plan.plannedBlocks) {
        expect(block.startDate).toBeDefined();
        expect(block.shiftCode).toMatch(/^T[67]$/);
      }
    }
    expect(sumPlannedTurns(plans)).toBeGreaterThan(0);
  });

  it("plannedTurns ≈ materializedTurns — discardedTurns ≤ 1", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.initRateioContext();
    allocateT8BlocksStrict(ws);
    const targets = [
      makeTarget(paoUuid(0), "PAO-A", 12),
      makeTarget(paoUuid(1), "PAO-B", 12),
      makeTarget(paoUuid(2), "PAO-C", 9),
      makeTarget(paoUuid(3), "PAO-D", 9),
    ];
    const result = materializeT6T7BlocksStrict(ws, targets);

    expect(result.feasibility.discardedTurns).toBeLessThanOrEqual(1);
    expect(Math.abs(result.feasibility.plannedTurns - result.feasibility.materializedTurns)).toBeLessThanOrEqual(1);
  });

  it("jul/2026 — discardedTurns ≤ 1 após materialização V3", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const ws = new GenerationWorkspace(input);
    ws.realV1ManualCommonFolga = true;
    ws.applyHardBlocks();
    ws.planFolgaSocial();
    ws.initRateioContext();
    allocateT8BlocksStrict(ws);
    materializeVacationFortnightPatterns(ws);
    const { targets } = computeRealMotorTargets(ws);

    const result = materializeT6T7BlocksStrict(ws, targets);

    expect(result.feasibility.discardedTurns).toBeLessThanOrEqual(1);
    expect(
      Math.abs(result.feasibility.plannedTurns - result.feasibility.materializedTurns),
    ).toBeLessThanOrEqual(1);
  });
});
