import { describe, expect, it } from "vitest";
import { minimalPaoInput } from "./generation-fixtures.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { buildScheduleRateioContext, syncRateioCountsFromWorkspace } from "../domain/schedule/schedule-rateio-context.js";
import { countRateioTurns } from "../domain/schedule/pao-rateio-shifts.js";
import { assignmentKey } from "../domain/schedule/types.js";
import { isParallelOnlyPreferredPao } from "../domain/schedule/employee-t6-t7-shift.js";

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
  it("julho/2026: 10 PAOs com max ceil(93/10)=10 turnos", () => {
    const input = minimalPaoInput(10);
    input.year = 2026;
    input.month = 7;
    const ws = new GenerationWorkspace(input);
    const ctx = buildScheduleRateioContext(ws);

    expect(ctx.daysInMonth).toBe(31);
    expect(ctx.mainPoolEmployeeIds.size).toBe(10);
    for (const id of ctx.mainPoolEmployeeIds) {
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

  it("syncRateioCountsFromWorkspace conta só T6/T7/T8/T9 e resiste a chamadas repetidas", () => {
    const input = minimalPaoInput(2);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = input.employees[0]!.uuid;
    const did = ws.uuidToDomain.get(uuid)!;

    ws.planned.set(assignmentKey(did, "2026-07-01"), "T6");
    ws.planned.set(assignmentKey(did, "2026-07-02"), "T7");
    ws.planned.set(assignmentKey(did, "2026-07-03"), "T8");
    ws.planned.set(assignmentKey(did, "2026-07-04"), "T9");
    ws.lockDay(uuid, "2026-07-05", "ND", false);
    ws.lockDay(uuid, "2026-07-06", "FOLGA", false);
    ws.lockDay(uuid, "2026-07-07", "VOO", false);

    const ctx = buildScheduleRateioContext(ws);
    expect(countRateioTurns(ws, uuid)).toBe(4);
    expect(ctx.currentTurnCounts.get(uuid)).toBe(4);
    expect(ctx.currentT6Counts.get(uuid)).toBe(1);
    expect(ctx.currentT7Counts.get(uuid)).toBe(1);
    expect(ctx.currentT8Counts.get(uuid)).toBe(1);
    expect(ctx.currentT9Counts.get(uuid)).toBe(1);

    syncRateioCountsFromWorkspace(ws, ctx);
    syncRateioCountsFromWorkspace(ws, ctx);
    expect(ctx.currentTurnCounts.get(uuid)).toBe(4);
  });
});
