import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  applyV5PreferenceLockFromCheckpoint,
  canUnassignV5LockedPreference,
  clearV5PreferenceLockTracking,
} from "../domain/schedule/v5-preference-lock-final.js";
import { capturePreferenceCheckpoint } from "../domain/schedule/preference-repair-impact-audit.js";

import type { ShiftCode } from "../domain/schedule/assignment-eligibility.js";

function pao(id: number, seniority: number, name?: string): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name: name ?? `PAO ${id}`, role: "PAO", seniority },
  };
}

function prefMap(entries: Array<[number, ShiftCode]>): Map<number, Set<string>> {
  return new Map(entries.map(([id, code]) => [id, new Set([code])]));
}

function minimalInput(
  employees: GenerationInputEmployee[],
  prefs?: Map<number, Set<string>>,
): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees,
    shifts: [
      {
        code: "T6",
        name: "T6",
        role: "PAO",
        active: true,
        startTime: "06:00",
        endTime: "14:00",
        minStaff: 1,
        maxStaff: 1,
        coverageType: "REQUIRED",
      },
      {
        code: "T7",
        name: "T7",
        role: "PAO",
        active: true,
        startTime: "14:00",
        endTime: "22:00",
        minStaff: 1,
        maxStaff: 1,
        coverageType: "REQUIRED",
      },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts: prefs ?? prefMap(employees.map((e) => [e.domainId, "T6"])),
  };
}

describe("v5-preference-lock-final", () => {
  it("bloqueia unassign de slot preferido locked", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1), pao(2, 2)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");
    ws.tryAssignShift("pao-1", "2026-07-06", "T6");

    const cp = capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "before_repair_gaps_final");
    applyV5PreferenceLockFromCheckpoint(ws, cp);

    expect(ws.v5LockedPreferenceEmployees.has("pao-1")).toBe(true);
    expect(ws.unassignShift("pao-1", "2026-07-05")).toBe(false);
    expect(ws.tryRemoveShiftPreservingCoverage("pao-1", "2026-07-05")).toBe(false);
  });

  it("permite remover turno não preferido de PAO locked", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");
    ws.tryAssignShift("pao-1", "2026-07-06", "T7");

    const cp = capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "before_repair_gaps_final");
    applyV5PreferenceLockFromCheckpoint(ws, cp);

    expect(canUnassignV5LockedPreference(ws, "pao-1", "2026-07-06", "T7")).toBe(true);
    expect(ws.unassignShift("pao-1", "2026-07-06")).toBe(true);
  });

  it("não locka PAO abaixo de 100% no checkpoint", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");
    ws.tryAssignShift("pao-1", "2026-07-06", "T7");

    const cp = capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "before_repair_gaps_final");
    applyV5PreferenceLockFromCheckpoint(ws, cp);

    expect(ws.v5LockedPreferenceEmployees.size).toBe(0);
    expect(ws.unassignShift("pao-1", "2026-07-05")).toBe(true);
  });

  it("permite remover duplicata de cobertura mesmo locked", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1), pao(2, 2)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");
    ws.tryAssignShift("pao-2", "2026-07-05", "T6");

    const cp = capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "before_repair_gaps_final");
    applyV5PreferenceLockFromCheckpoint(ws, cp);

    expect(canUnassignV5LockedPreference(ws, "pao-1", "2026-07-05", "T6")).toBe(true);
    expect(canUnassignV5LockedPreference(ws, "pao-2", "2026-07-05", "T6")).toBe(true);
  });

  it("bloqueia alocação não preferida em PAO locked", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");

    const cp = capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "before_repair_gaps_final");
    applyV5PreferenceLockFromCheckpoint(ws, cp);

    expect(ws.tryAssignShift("pao-1", "2026-07-06", "T7")).toBe(false);
    expect(ws.tryAssignShift("pao-1", "2026-07-07", "T6")).toBe(true);
  });

  it("clearV5PreferenceLockTracking zera estado", () => {
    const ws = new GenerationWorkspace(minimalInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryAssignShift("pao-1", "2026-07-05", "T6");
    const cp = capturePreferenceCheckpoint(ws, ws.ensureRateioContext(), "before_repair_gaps_final");
    applyV5PreferenceLockFromCheckpoint(ws, cp);
    clearV5PreferenceLockTracking(ws);
    expect(ws.v5LockedPreferenceEmployees.size).toBe(0);
    expect(ws.unassignShift("pao-1", "2026-07-05")).toBe(true);
  });
});
