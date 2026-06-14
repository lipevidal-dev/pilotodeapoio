import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { deduplicatePaoShiftCoverage } from "../domain/schedule/pao-shift-dedup.js";
import {
  repairT8GapsAfterDedup,
} from "../domain/schedule/repair-t8-gaps-after-dedup.js";
import { minimalPaoInput } from "./generation-fixtures.js";

describe("repair-t8-gaps-after-dedup", () => {
  it("fecha gap T8 com bloco T8/T8/ND após dedup", () => {
    const ws = new GenerationWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.initRateioContext();

    const senior = ws.paoEmps[0]!.uuid;
    const junior = ws.paoEmps[1]!.uuid;
    const day = "2026-06-18";

    ws.tryPlaceT8Block(senior, "2026-06-10");
    ws.tryPlaceT8Block(junior, day);
    ws.seedAssignments([
      { employeeUuid: senior, date: day, shiftCode: "T8" },
      { employeeUuid: junior, date: day, shiftCode: "T8" },
    ]);

    expect(deduplicatePaoShiftCoverage(ws)).toBe(1);
    expect(ws.findPaoOnShift(day, "T8")).toBe(senior);

    const audit = repairT8GapsAfterDedup(ws);
    expect(ws.hasPaoCoverage(day, "T8")).toBe(true);
    expect(audit.gapsRemaining).toBe(0);
  });

  it("REAL_V1: 0 duplicatas e 0 gaps T8 no cenário realista", async () => {
    const { RealScheduleEngine } = await import("../domain/schedule/real-schedule-engine.js");
    const { realisticGenerationInput } = await import("./realistic-fixtures.js");
    const result = new RealScheduleEngine().generate(realisticGenerationInput());

    const dupes = result.assignments.filter((a) =>
      result.assignments.some(
        (b) =>
          b.date === a.date &&
          b.shiftCode === a.shiftCode &&
          b.employeeUuid !== a.employeeUuid,
      ),
    );
    expect(dupes).toHaveLength(0);
    expect(result.summary.coverageMissingCount ?? result.summary.coverageGaps).toBe(0);
  });
});

describe("repairT8GapsAfterDedup — unitário", () => {
  it("retorna auditoria com gapsRemaining", () => {
    const ws = new GenerationWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.initRateioContext();
    const audit = repairT8GapsAfterDedup(ws);
    expect(audit.gapsRemaining).toBeGreaterThanOrEqual(0);
  });
});
