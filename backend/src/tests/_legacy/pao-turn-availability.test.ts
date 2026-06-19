import { describe, expect, it } from "vitest";
import { minimalPaoInput } from "./generation-fixtures.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { buildScheduleRateioContext } from "../domain/schedule/schedule-rateio-context.js";
import { isParallelOnlyPreferredPao } from "../domain/schedule/employee-t6-t7-shift.js";
import {
  computeProportionalTurnTargets,
  countCalendarAvailableDaysForRateio,
} from "../domain/schedule/pao-turn-availability.js";

import type { Shift } from "../domain/shift/types.js";

function t9Shift(): Shift {
  return {
    code: "T9",
    role: "PAO",
    name: "Turno 9 PAO",
    startTime: "10:00",
    endTime: "18:00",
    minStaff: 1,
    maxStaff: 1,
    coverageType: "PARALLEL",
  };
}

describe("buildScheduleRateioContext", () => {
  it("julho/2026: 10 PAOs com max ceil(93/10)=10 turnos (disponibilidade plena)", () => {
    const input = minimalPaoInput(10);
    input.year = 2026;
    input.month = 7;
    const ws = new GenerationWorkspace(input);
    const ctx = buildScheduleRateioContext(ws);

    expect(ctx.daysInMonth).toBe(31);
    expect(ctx.mainPoolEmployeeIds.size).toBe(10);
    for (const id of ctx.mainPoolEmployeeIds) {
      expect(ctx.availableDaysByEmployee.get(id)).toBe(31);
      expect(ctx.relativeAvailabilityByEmployee.get(id)).toBeCloseTo(1, 5);
      expect(ctx.maxTurnCounts.get(id)).toBe(10);
      expect(ctx.minTurnCounts.get(id)).toBe(8);
    }
  });

  it("exclui preferencial T9 exclusivo do pool principal", () => {
    const input = minimalPaoInput(10);
    input.year = 2026;
    input.month = 7;
    input.shifts = [
      ...DEFAULT_SHIFTS.map((s) => ({ ...s, coverageType: "REQUIRED" as const })),
      t9Shift(),
    ];
    input.preferredShifts = new Map([
      [input.employees[0]!.domainId, new Set(["T9"])],
      [input.employees[1]!.domainId, new Set(["T9"])],
    ]);
    const ws = new GenerationWorkspace(input);
    expect(isParallelOnlyPreferredPao(ws, input.employees[0]!.uuid)).toBe(true);

    const ctx = buildScheduleRateioContext(ws);
    expect(ctx.t9PoolEmployeeIds.size).toBe(2);
    expect(ctx.mainPoolEmployeeIds.size).toBe(8);

    for (const id of ctx.mainPoolEmployeeIds) {
      expect(ctx.maxTurnCounts.get(id)).toBe(12);
      expect(ctx.minTurnCounts.get(id)).toBe(10);
    }
    for (const id of ctx.t9PoolEmployeeIds) {
      expect(ctx.t8PoolEmployeeIds.has(id)).toBe(true);
    }
  });

  it("reduz meta proporcionalmente com férias longas", () => {
    const input = minimalPaoInput(2);
    input.year = 2026;
    input.month = 7;
    const uuidA = input.employees[0]!.uuid;
    const uuidB = input.employees[1]!.uuid;

    input.vacationDays = input.vacationDays ?? [];
    for (let d = 1; d <= 24; d++) {
      input.vacationDays.push({
        employeeUuid: uuidA,
        date: `2026-07-${String(d).padStart(2, "0")}`,
      });
    }

    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const ctx = buildScheduleRateioContext(ws);

    const availA = countCalendarAvailableDaysForRateio(ws, uuidA);
    const availB = countCalendarAvailableDaysForRateio(ws, uuidB);
    expect(availA).toBeLessThan(availB);

    const targetA = ctx.targetTurnCounts.get(uuidA)!;
    const targetB = ctx.targetTurnCounts.get(uuidB)!;
    expect(targetA).toBeLessThan(targetB);
    expect(ctx.minTurnCounts.get(uuidA)!).toBeLessThan(ctx.minTurnCounts.get(uuidB)!);

    const proportional = computeProportionalTurnTargets(ws, [uuidA, uuidB], 31 * 3);
    const sumTargets =
      (proportional.targetTurnCounts.get(uuidA) ?? 0) +
      (proportional.targetTurnCounts.get(uuidB) ?? 0);
    expect(sumTargets).toBeCloseTo(31 * 3, 5);
  });

  it("cadastros CURSO/SIM/CMA não reduzem dias disponíveis para meta", () => {
    const input = minimalPaoInput(2);
    input.year = 2026;
    input.month = 7;
    const uuid = input.employees[0]!.uuid;
    input.lockedAllocations = [
      { employeeUuid: uuid, date: "2026-07-01", label: "CURSO" },
      { employeeUuid: uuid, date: "2026-07-02", label: "SIMULADOR" },
      { employeeUuid: uuid, date: "2026-07-03", label: "CMA" },
    ];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const ctx = buildScheduleRateioContext(ws);

    expect(countCalendarAvailableDaysForRateio(ws, uuid)).toBe(31);
    expect(ctx.targetTurnCounts.get(uuid)).toBeCloseTo(ctx.targetTurnCounts.get(input.employees[1]!.uuid)!, 5);
  });
});
