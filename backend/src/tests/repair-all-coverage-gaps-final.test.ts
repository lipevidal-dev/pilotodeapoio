import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import {
  repairAllCoverageGapsFinal,
  validateNoCoverageGaps,
} from "../domain/schedule/repair-all-coverage-gaps-final.js";
import { sortPaoForCoverageCandidates } from "../domain/schedule/real-schedule-turn-rateio.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";

describe("repairAllCoverageGapsFinal", () => {
  it("fecha gaps T8 com T8 isolado emergencial quando bloco é impossível", () => {
    const ws = new GenerationWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.initRateioContext();

    const gapDay = ws.days[2]!;
    for (const c of ws.paoEmps) {
      ws.unassignShift(c.uuid, gapDay, { bypassT8Protection: true });
    }

    expect(ws.hasPaoCoverage(gapDay, "T8")).toBe(false);

    const audit = repairAllCoverageGapsFinal(ws, ws.rateioContext!);
    expect(ws.hasPaoCoverage(gapDay, "T8")).toBe(true);
    expect(audit.gapsRemaining).toBe(0);
    expect(validateNoCoverageGaps(ws)).toHaveLength(0);
  });

  it("motor realístico mantém gaps=0 após geração completa", () => {
    const result = realScheduleEngine.generate(realisticGenerationInput());

    const ws = new GenerationWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    for (const a of result.assignments) {
      const did = ws.uuidToDomain.get(a.employeeUuid);
      if (did == null) continue;
      ws.planned.set(`${did}|${a.date}`, a.shiftCode);
    }
    for (const al of result.allocations) {
      ws.lockDay(al.employeeUuid, al.date, al.label, false);
    }

    expect(ws.listCoverageGaps()).toHaveLength(0);
  });

  it("sortPaoForCoverageCandidates inclui PAOs no max como fallback", () => {
    const ws = new GenerationWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.initRateioContext();
    const ctx = ws.rateioContext!;

    for (const c of ws.paoEmps) {
      const max = ctx.maxTurnCounts.get(c.uuid) ?? 0;
      ctx.currentTurnCounts.set(c.uuid, max);
    }

    const sorted = sortPaoForCoverageCandidates(ws, 0);
    expect(sorted.length).toBe(ws.paoEmps.length);
  });
});
