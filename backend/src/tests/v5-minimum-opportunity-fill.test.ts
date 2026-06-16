import { describe, expect, it } from "vitest";
import type { ShiftCode } from "../domain/schedule/assignment-eligibility.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  minimumOpportunityFill,
} from "../domain/schedule/v5-minimum-opportunity-fill.js";
import { currentTurnCount } from "../domain/schedule/schedule-rateio-context.js";

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
    preferredShifts: prefMap(employees.map((e) => [e.domainId, "T6"])),
  };
}

describe("v5-minimum-opportunity-fill", () => {
  it("prioriza PAO com maior déficit e aloca em dia vazio", () => {
    const ws = new GenerationWorkspace(julyInput([pao(1, 1), pao(2, 10)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    const ctx = ws.ensureRateioContext();

    const report = minimumOpportunityFill(ws, []);
    ws.syncRateioContext();

    expect(report.totalAttempts).toBeGreaterThan(0);
    expect(report.totalAccepted).toBeGreaterThan(0);
    expect(currentTurnCount(ctx, "pao-1")).toBeGreaterThan(0);
    expect(ws.v55MinimumOpportunityAudit.length).toBeGreaterThan(0);
  });
});
