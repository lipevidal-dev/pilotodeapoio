import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  buildPreferenceRepairImpact,
  capturePreferenceCheckpoint,
  formatPreferenceRepairImpact,
} from "../domain/schedule/preference-repair-impact-audit.js";
import { assignmentKey } from "../domain/schedule/types.js";

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
      { code: "T7", name: "T7", role: "PAO", active: true, startTime: "14:00", endTime: "22:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts: new Map([[1, new Set(["T6"])]]),
  };
}

describe("preference-repair-impact-audit", () => {
  it("conta turnos preferidos removidos entre checkpoints", () => {
    const input = minimalInput([pao(1, 1)]);
    const wsBefore = new GenerationWorkspace(input);
    wsBefore.applyHardBlocks();
    wsBefore.initRateioContext();
    wsBefore.tryAssignShift("pao-1", "2026-07-01", "T6");
    wsBefore.tryAssignShift("pao-1", "2026-07-02", "T6");
    wsBefore.tryAssignShift("pao-1", "2026-07-03", "T7");

    const wsAfter = new GenerationWorkspace(input);
    wsAfter.applyHardBlocks();
    wsAfter.initRateioContext();
    wsAfter.tryAssignShift("pao-1", "2026-07-01", "T6");
    wsAfter.tryAssignShift("pao-1", "2026-07-02", "T7");
    wsAfter.tryAssignShift("pao-1", "2026-07-03", "T7");

    const before = capturePreferenceCheckpoint(wsBefore, wsBefore.rateioContext!, "before");
    const after = capturePreferenceCheckpoint(wsAfter, wsAfter.rateioContext!, "after");
    const impact = buildPreferenceRepairImpact(before, after);

    expect(impact.totalPreferredRemoved).toBe(1);
    expect(impact.rows[0]!.preferredBefore).toBe(2);
    expect(impact.rows[0]!.preferredAfter).toBe(1);
    expect(impact.rows[0]!.attendanceBefore).toBe(67);
    expect(impact.rows[0]!.attendanceAfter).toBe(33);
    expect(formatPreferenceRepairImpact(impact)).toContain("PREFERRED_REPLACED");
  });

  it("detecta remoção total de slot preferido", () => {
    const input = minimalInput([pao(1, 1)]);
    const wsBefore = new GenerationWorkspace(input);
    wsBefore.applyHardBlocks();
    wsBefore.initRateioContext();
    const did = wsBefore.uuidToDomain.get("pao-1")!;
    wsBefore.planned.set(assignmentKey(did, "2026-07-05"), "T6");

    const wsAfter = new GenerationWorkspace(input);
    wsAfter.applyHardBlocks();
    wsAfter.initRateioContext();

    const before = capturePreferenceCheckpoint(wsBefore, wsBefore.rateioContext!, "before");
    const after = capturePreferenceCheckpoint(wsAfter, wsAfter.rateioContext!, "after");
    const impact = buildPreferenceRepairImpact(before, after);

    expect(impact.totalPreferredRemoved).toBe(1);
    expect(impact.rows[0]!.slotChanges[0]!.kind).toBe("PREFERRED_REMOVED");
  });
});
