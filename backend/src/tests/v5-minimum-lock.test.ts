import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  canUnassignMinimumLock,
  wouldDropBelowMin,
} from "../domain/schedule/v5-minimum-lock.js";
import { currentTurnCount } from "../domain/schedule/schedule-rateio-context.js";

function pao(id: number, seniority: number): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name: `PAO ${id}`, role: "PAO", seniority },
  };
}

function julyInput(employees: GenerationInputEmployee[]): GenerationInput {
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
    preferredShifts: new Map([[1, new Set(["T6"])]]),
  };
}

describe("v5-minimum-lock", () => {
  it("bloqueia unassign quando PAO está no mínimo proporcional", () => {
    const ws = new GenerationWorkspace(julyInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v56MinimumLockEnabled = true;
    const ctx = ws.ensureRateioContext();
    ctx.minTurnCounts.set("pao-1", 2);

    expect(ws.tryAssignShift("pao-1", ws.days[0]!, "T6")).toBe(true);
    expect(ws.tryAssignShift("pao-1", ws.days[1]!, "T6")).toBe(true);
    ws.syncRateioContext();
    expect(currentTurnCount(ctx, "pao-1")).toBe(2);

    const day = ws.days.find((d) => ws.toAssignments().some((a) => a.employeeUuid === "pao-1" && a.date === d))!;
    expect(wouldDropBelowMin(ws, "pao-1", "T6")).toBe(true);
    expect(canUnassignMinimumLock(ws, "pao-1", day, "T6")).toBe(false);
    expect(ws.unassignShift("pao-1", day)).toBe(false);
    expect(ws.v56MinimumLockAudit.some((e) => e.result === "BLOCKED")).toBe(true);
  });
});
