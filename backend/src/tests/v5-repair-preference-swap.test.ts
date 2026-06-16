import { describe, expect, it } from "vitest";
import type { ShiftCode } from "../domain/schedule/assignment-eligibility.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  runV5RepairPreferenceSwap,
  mustPreserveT8PreferenceProfile,
} from "../domain/schedule/v5-repair-preference-swap.js";

function pao(id: number, seniority: number): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name: `PAO ${id}`, role: "PAO", seniority },
  };
}

function prefMap(entries: Array<[number, ShiftCode]>): Map<number, Set<string>> {
  return new Map(entries.map(([id, code]) => [id, new Set([code])]));
}

function julyInput(employees: GenerationInputEmployee[], prefs?: Map<number, Set<string>>): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees,
    shifts: [
      { code: "T6", name: "T6", role: "PAO", active: true, startTime: "06:00", endTime: "14:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T7", name: "T7", role: "PAO", active: true, startTime: "14:00", endTime: "22:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T8", name: "T8", role: "PAO", active: true, startTime: "22:00", endTime: "06:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts: prefs,
  };
}

describe("v5-repair-preference-swap", () => {
  it("troca T7↔T6 same-day recuperando preferência", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 11)], prefMap([[1, "T7"], [2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.rateioContext!.targetTurnCounts.set("pao-1", 1);
    ws.rateioContext!.targetTurnCounts.set("pao-2", 2);

    ws.tryAssignShift("pao-2", "2026-07-10", "T7");
    ws.tryAssignShift("pao-1", "2026-07-10", "T6");
    ws.syncRateioContext();

    const gapsBefore = ws.listCoverageGaps().length;
    const result = runV5RepairPreferenceSwap(ws, [], { allowWithGaps: true });
    expect(result.swapsApplied).toBe(1);
    expect(result.gapsAfter).toBe(gapsBefore);
    expect(ws.findPaoOnShift("2026-07-10", "T6")).toBe("pao-2");
    expect(ws.findPaoOnShift("2026-07-10", "T7")).toBe("pao-1");
    expect(ws.v5RepairPreferenceSwapLog.some((r) => r.result === "OK")).toBe(true);
  });

  it("não remove T8 de perfil 100% T8", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 2)], prefMap([[1, "T8"], [2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();

    ws.tryAssignShift("pao-1", "2026-07-05", "T8");
    ws.syncRateioContext();
    expect(mustPreserveT8PreferenceProfile(ws, "pao-1")).toBe(true);

    ws.tryAssignShift("pao-2", "2026-07-05", "T7");
    const before = ws.findPaoOnShift("2026-07-05", "T8");
    runV5RepairPreferenceSwap(ws);
    expect(ws.findPaoOnShift("2026-07-05", "T8")).toBe(before);
  });
});
