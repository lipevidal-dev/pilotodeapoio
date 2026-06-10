import { describe, expect, it } from "vitest";
import { ScheduleRepairEngine } from "../domain/schedule/schedule-repair-engine.js";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import { minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";
import { IDEAL_PAO_REST_COUNT } from "../domain/rules/constants.js";

describe("reparo de cobertura — coverageEmergency", () => {
  const repairEngine = new ScheduleRepairEngine();

  it("preenche T7 quando PAO elegível está no limite de orçamento mensal", () => {
    const ws = new GenerationWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    const day = "2026-06-21";

    ws.tryAssignShift(paoUuid(1), day, "T6", true);
    ws.tryAssignShift(paoUuid(2), day, "T8", true);
    ws.lockDay(paoUuid(3), day, "FOLGA SOCIAL");

    for (const d of ws.days) {
      if (d === day) continue;
      if (ws.isDayBlockedForShift(uuid, d)) continue;
      if (ws.tryAssignShift(uuid, d, d.endsWith("1") ? "T7" : "T6")) continue;
      ws.tryAssignShift(uuid, d, "T7", true);
    }

    const budgetProbe =
      ws.workCount(uuid) + 1 + ws.countNd(uuid) + IDEAL_PAO_REST_COUNT;
    expect(budgetProbe).toBeGreaterThan(ws.days.length);
    expect(ws.tryAssignShift(uuid, day, "T7")).toBe(false);
    expect(ws.hasPaoCoverage(day, "T7")).toBe(false);

    const result = repairEngine.repair(ws, []);
    expect(result.repaired).toBeGreaterThan(0);
    expect(ws.hasPaoCoverage(day, "T7")).toBe(true);
  });

  it("cenário realista junho/2026 zera furo de T7 no dia 21", () => {
    const result = new ScheduleGenerationEngine(new RealScheduleEngine()).generate(
      realisticGenerationInput(),
    );
    expect(result.summary.coverageMissingCount).toBe(0);
    const day = "2026-06-21";
    const t7 = result.assignments.some((a) => a.date === day && a.shiftCode === "T7");
    expect(t7).toBe(true);
  });
});
