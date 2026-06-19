import { describe, expect, it } from "vitest";
import type { ShiftCode } from "../domain/schedule/assignment-eligibility.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  repairPreferenceTier,
  sortPaoForV5RepairCoverage,
  tryV5RepairAssignOnGap,
} from "../domain/schedule/v5-repair-preference.js";
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

describe("v5-repair-preference", () => {
  it("ordena pref=gap antes de pref diferente", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 2), pao(3, 3)], prefMap([[1, "T8"], [2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v5RepairPreferenceStrict = true;

    const ctx = ws.rateioContext!;
    expect(repairPreferenceTier(ctx, "pao-2", "T6")).toBe(0);
    expect(repairPreferenceTier(ctx, "pao-3", "T6")).toBe(1);
    expect(repairPreferenceTier(ctx, "pao-1", "T6")).toBe(2);

    const sorted = sortPaoForV5RepairCoverage(ws, 0, [], "T6");
    expect(sorted[0]!.uuid).toBe("pao-2");
  });

  it("repair V5 prefere PAO com pref T6 para gap T6", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 2)], prefMap([[1, "T8"], [2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v5RepairPreferenceStrict = true;

    ws.tryAssignShift("pao-1", "2026-07-05", "T8");

    const warnings: ValidationIssue[] = [];
    const attempt = tryV5RepairAssignOnGap(
      ws,
      "2026-07-10",
      "T6",
      5,
      false,
      warnings,
      (uuid) => ws.tryAssignShift(uuid, "2026-07-10", "T6"),
    );

    expect(attempt.placed).toBe(true);
    expect(ws.findPaoOnShift("2026-07-10", "T6")).toBe("pao-2");
    expect(warnings.length).toBe(0);
  });

  it("perfil 100% T6 não recebe T7 no repair quando pref T6 pode preencher", () => {
    const ws = new GenerationWorkspace(
      julyInput([pao(1, 1), pao(2, 2)], prefMap([[1, "T7"], [2, "T6"]])),
    );
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v5RepairPreferenceStrict = true;

    ws.tryAssignShift("pao-2", "2026-07-03", "T6");
    ws.tryAssignShift("pao-2", "2026-07-04", "T6");
    ws.tryAssignShift("pao-1", "2026-07-10", "T7");

    const warnings: ValidationIssue[] = [];
    const attempt = tryV5RepairAssignOnGap(
      ws,
      "2026-07-15",
      "T6",
      10,
      false,
      warnings,
      (uuid) => ws.tryAssignShift(uuid, "2026-07-15", "T6"),
    );

    expect(attempt.placed).toBe(true);
    expect(ws.findPaoOnShift("2026-07-15", "T6")).toBe("pao-2");
    expect(warnings.length).toBe(0);
    expect(ws.toAssignments().filter((a) => a.employeeUuid === "pao-2" && a.shiftCode === "T7").length).toBe(0);
  });
});
