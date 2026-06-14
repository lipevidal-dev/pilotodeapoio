import { describe, expect, it } from "vitest";
import {
  formatPostV4EnforceTurnTrace,
  runPostV4EnforceTurnTrace,
  tracePostV4EnforceTurnSnapshots,
} from "../domain/schedule/v4-post-enforce-turn-trace.js";
import { prepareWorkspaceThroughPreV4Enforce } from "../domain/schedule/real-schedule-engine.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

describe("v4-post-enforce-turn-trace", () => {
  it("gera snapshots em todos os checkpoints pós-enforce", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const trace = runPostV4EnforceTurnTrace(input);

    expect(trace.checkpoints.length).toBeGreaterThanOrEqual(7);
    expect(trace.checkpoints[0]!.label).toContain("antes enforce");
    expect(trace.checkpoints.some((c) => c.label.includes("depois enforce [11d]"))).toBe(true);
    expect(trace.checkpoints.some((c) => c.label.includes("block optimizer"))).toBe(true);
    expect(trace.checkpoints.some((c) => c.label.includes("repairAllCoverageGapsFinal"))).toBe(true);
    expect(trace.checkpoints.some((c) => c.label.includes("buildTurnRateioAudit"))).toBe(true);
  });

  it("formata tabela focada em Gustavo/Lucas", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const formatted = formatPostV4EnforceTurnTrace(runPostV4EnforceTurnTrace(input), [
      "Gustavo",
      "Lucas",
    ]);

    expect(formatted).toContain("V4 PÓS-ENFORCE");
    expect(formatted).toContain("Gustavo 02/07");
    expect(formatted).toContain("Lucas 15/07");
  });

  it("tracePostV4EnforceTurnSnapshots executa checkpoints sem erro", () => {
    const input = realisticGenerationInput({ year: 2026, month: 6 });
    const ws = prepareWorkspaceThroughPreV4Enforce(input);
    const trace = tracePostV4EnforceTurnSnapshots(ws);
    expect(trace.checkpoints.length).toBeGreaterThanOrEqual(7);
  });
});
