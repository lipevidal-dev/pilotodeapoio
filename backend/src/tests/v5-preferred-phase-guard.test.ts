import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  markV5PreferredPhaseDay,
  setV5PipelineStage,
} from "../domain/schedule/v5-preferred-phase-guard.js";
import { finalizeT8NdBlocks, finalizeT8NdBlocksForV5PreRepair } from "../domain/schedule/schedule-grid-source.js";

function pao(id: number, seniority: number): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name: `PAO ${id}`, role: "PAO", seniority },
  };
}

function minimalInput(employees: GenerationInputEmployee[]): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees,
    shifts: [
      { code: "T6", name: "T6", role: "PAO", active: true, startTime: "06:00", endTime: "14:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T8", name: "T8", role: "PAO", active: true, startTime: "22:00", endTime: "06:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
  };
}

describe("v5-preferred-phase-guard", () => {
  it("repairIsolatedT8 não remove T8 mono da fase preferida", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-10", "T8");
    markV5PreferredPhaseDay(ws, "pao-1", "2026-07-10");

    finalizeT8NdBlocksForV5PreRepair(ws);
    expect(
      ws.toAssignments().some((a) => a.date === "2026-07-10" && a.shiftCode === "T8"),
    ).toBe(true);

    finalizeT8NdBlocks(ws);
    expect(
      ws.toAssignments().some((a) => a.date === "2026-07-10" && a.shiftCode === "T8"),
    ).toBe(true);
  });

  it("unassignShift bloqueia remoção de dia preferido sem motivo", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");
    markV5PreferredPhaseDay(ws, "pao-1", "2026-07-05");
    setV5PipelineStage(ws, "fill_complementary");

    expect(ws.unassignShift("pao-1", "2026-07-05")).toBe(false);
    expect(ws.v5PreferredPhaseRemovalLog.length).toBe(0);

    expect(
      ws.unassignShift("pao-1", "2026-07-05", {
        bypassPreferredPhaseProtection: true,
        preferredRemovalReason: "REST_12H",
        preferredRemovalDetail: "teste",
      }),
    ).toBe(true);
    expect(ws.v5PreferredPhaseRemovalLog.length).toBe(1);
  });
});
