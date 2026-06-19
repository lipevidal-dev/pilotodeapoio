import { describe, expect, it } from "vitest";
import { realScheduleEngineV5 } from "../domain/schedule/real-schedule-engine-v5.js";
import { runV57PostLockCoverage } from "../domain/schedule/v5-pipeline-hardening.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

describe("v5-pipeline-hardening", () => {
  it("runV57PostLockCoverage conclui sem exceção", () => {
    const input = realisticGenerationInput({ month: 7 });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v56MinimumLockEnabled = true;

    const report = runV57PostLockCoverage(ws);
    expect(report.notes.some((n) => n.includes("[V5.7]"))).toBe(true);
  });

  it("motor V5 inclui auditoria V5.7 GUARDS", () => {
    const result = realScheduleEngineV5.generate(realisticGenerationInput({ month: 7 }));
    const stepNotes = result.summary.realMotorReport?.stepNotes;
    const notes = Array.isArray(stepNotes) ? stepNotes.join("\n") : "";
    expect(notes).toContain("V5.7 GUARDS");
    expect(notes).toContain("[V5.7]");
  });
});
