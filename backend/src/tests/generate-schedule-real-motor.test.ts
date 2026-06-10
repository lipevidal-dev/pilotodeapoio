import { describe, expect, it, vi } from "vitest";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import {
  LegacyScheduleGenerationEngine,
  ScheduleGenerationEngine,
} from "../domain/schedule/schedule-generation-engine.js";
import {
  ENGINE_PATH,
  MOTOR_VERSION_ID,
} from "../domain/schedule/real-schedule-types.js";
import type { GenerationInput, GenerationResult } from "../domain/schedule/generation-types.js";
import { minimalPaoInput } from "./generation-fixtures.js";

function mockRepos() {
  return {
    scheduleRepo: {
      findMonth: async () => null,
      listActiveEmployees: async () => [],
      listShifts: async () => minimalPaoInput().shifts,
      listRoles: async () => [],
      loadCrossMonthHistory: async () => ({}),
      listShiftRestrictionsForMonth: async () => [],
      listPreferredShiftsForMonth: async () => [],
      listNoFlightDatesForMonth: async () => [],
      upsertGeneratedMonth: async () => ({ id: "month-1" }),
      clearForRegeneration: async () => {},
      saveAssignments: async () => {},
      saveGeneratedPreAllocations: async () => {},
      saveViolations: async () => {},
    },
    calendarRepo: {
      listVacationDaysForMonth: async () => [],
      listVacationReturnDaysForMonth: async () => [],
      listApprovedDayOffForMonth: async () => [],
      listFlightDaysForMonth: async () => [],
    },
    preAllocRepo: {
      findAll: async () => [],
    },
  };
}

function stubGenerationResult(): GenerationResult {
  return {
    assignments: [{ employeeUuid: "uuid-1", date: "2026-06-01", shiftCode: "T6" }],
    allocations: [],
    violations: [],
    summary: {
      valid: true,
      totalAssignments: 1,
      totalAllocations: 0,
      paoCount: 1,
      apaoCount: 0,
      folgasPerPao: {},
      coverageGaps: 0,
      blockingViolations: 0,
      totalViolations: 0,
      motorVersion: MOTOR_VERSION_ID,
      enginePath: ENGINE_PATH,
      realEngineExecuted: true,
    },
    success: true,
    suggestions: [],
  };
}

describe("GenerateScheduleUseCase — motor REAL_V1", () => {
  it("endpoint use-case chama RealScheduleEngine (não legacy)", async () => {
    const realGenerate = vi.fn((_input: GenerationInput) => stubGenerationResult());
    const realEngine = { generate: realGenerate } as unknown as RealScheduleEngine;

    const { scheduleRepo, calendarRepo, preAllocRepo } = mockRepos();
    const uc = new GenerateScheduleUseCase(
      scheduleRepo as never,
      calendarRepo as never,
      preAllocRepo as never,
      realEngine,
    );

    const result = await uc.execute(2026, 6);

    expect(realGenerate).toHaveBeenCalledTimes(1);
    expect(result.motorVersion).toBe("REAL_V1");
    expect(result.enginePath).toBe("GenerateScheduleUseCase -> RealScheduleEngine");
    expect(result.realEngineExecuted).toBe(true);
    expect(result.summary.motorVersion).toBe("REAL_V1");
    expect(result.summary.enginePath).toBe(ENGINE_PATH);
    expect(result.summary.realEngineExecuted).toBe(true);
  });

  it("integração: ScheduleGenerationEngine delega ao RealScheduleEngine", () => {
    const realSpy = vi.spyOn(RealScheduleEngine.prototype, "generate");
    const legacySpy = vi.spyOn(LegacyScheduleGenerationEngine.prototype, "generate");

    const engine = new ScheduleGenerationEngine();
    engine.generate(minimalPaoInput(3));

    expect(realSpy).toHaveBeenCalledTimes(1);
    expect(legacySpy).not.toHaveBeenCalled();

    realSpy.mockRestore();
    legacySpy.mockRestore();
  });
});
