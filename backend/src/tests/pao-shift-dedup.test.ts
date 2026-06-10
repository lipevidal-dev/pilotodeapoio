import { describe, expect, it } from "vitest";
import { iterDays } from "../domain/rules/dates.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { deduplicatePaoShiftCoverage } from "../domain/schedule/pao-shift-dedup.js";
import { minimalPaoInput } from "./generation-fixtures.js";

function paoUuid(index: number): string {
  return `uuid-${index + 1}`;
}

describe("pao-shift-dedup", () => {
  it("remove PAO duplicado no mesmo turno/dia mantendo o mais sênior", () => {
    const input = minimalPaoInput(3);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    const day = iterDays(input.year, input.month)[10]!;
    const senior = paoUuid(0);
    const junior = paoUuid(1);

    ws.seedAssignments([
      { employeeUuid: senior, date: day, shiftCode: "T6" },
      { employeeUuid: junior, date: day, shiftCode: "T6" },
    ]);

    const removed = deduplicatePaoShiftCoverage(ws);
    expect(removed).toBe(1);
    expect(ws.findPaoOnShift(day, "T6")).toBe(senior);
  });

  it("REAL_V1 remove duplicatas e repara cobertura no cenário realista", async () => {
    const { RealScheduleEngine } = await import("../domain/schedule/real-schedule-engine.js");
    const { realisticGenerationInput } = await import("./realistic-fixtures.js");
    const result = new RealScheduleEngine().generate(realisticGenerationInput());
    const dupes = result.assignments.filter((a) => {
      const same = result.assignments.filter(
        (b) => b.date === a.date && b.shiftCode === a.shiftCode && b.employeeUuid !== a.employeeUuid,
      );
      return same.length > 0;
    });
    expect(dupes).toHaveLength(0);
    expect(result.summary.coverageMissingCount ?? result.summary.coverageGaps).toBe(0);
  });
});
