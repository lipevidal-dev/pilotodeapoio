import { describe, expect, it } from "vitest";
import type { ShiftCode } from "../domain/schedule/assignment-eligibility.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  v5FillRemainingQuotaWithAnyAllowedShift,
} from "../domain/schedule/v5-quota-allocation.js";
import { hasViablePreferredSlotRemaining } from "../domain/schedule/v5-fill-preference.js";
import type { ValidationIssue } from "../domain/schedule/types.js";

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

describe("v5-fill-preference strict", () => {
  it("não aloca T7 enquanto houver T6 viável para PAO pref T6", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 11)], prefMap([[2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.rateioContext!.targetTurnCounts.set("pao-2", 4);

    const warnings: ValidationIssue[] = [];
    v5FillRemainingQuotaWithAnyAllowedShift(ws, warnings);

    const lucasLike = ws.toAssignments().filter((a) => a.employeeUuid === "pao-2");
    const t6 = lucasLike.filter((a) => a.shiftCode === "T6").length;
    const t7 = lucasLike.filter((a) => a.shiftCode === "T7").length;

    expect(t6).toBeGreaterThan(0);
    expect(t7).toBe(0);
    expect(hasViablePreferredSlotRemaining(ws, "pao-2", "T6") || t6 >= 4).toBe(true);
  });

  it("só dilui com auditoria quando não resta T6 viável", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 2)], prefMap([[2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.rateioContext!.targetTurnCounts.set("pao-2", 2);

    for (const day of ws.days) {
      ws.tryAssignShift("pao-1", day, "T6");
    }

    const warnings: ValidationIssue[] = [];
    v5FillRemainingQuotaWithAnyAllowedShift(ws, warnings);

    expect(hasViablePreferredSlotRemaining(ws, "pao-2", "T6")).toBe(false);
    const t7 = ws.toAssignments().filter((a) => a.employeeUuid === "pao-2" && a.shiftCode === "T7");
    if (t7.length > 0) {
      expect(ws.v5FillPreferenceDilutionLog.length).toBeGreaterThan(0);
    }
  });
});
