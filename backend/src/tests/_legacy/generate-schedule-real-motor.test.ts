import { describe, expect, it, vi } from "vitest";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import {
  LegacyScheduleGenerationEngine,
  ScheduleGenerationEngine,
} from "../domain/schedule/schedule-generation-engine.js";
import {
  ENGINE_PATH,
} from "../domain/schedule/real-schedule-types.js";
import type { GenerationInput, GenerationResult } from "../domain/schedule/generation-types.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import { minimalPaoInput } from "./generation-fixtures.js";
import {
  mockPrismaEmployeesFromRealistic,
  mockPrismaRoles,
  mockPrismaShifts,
} from "./helpers/generate-schedule-mocks.js";

function mockRepos() {
  return {
    scheduleRepo: {
      findMonth: async () => null,
      listActiveEmployees: async () => mockPrismaEmployeesFromRealistic(),
      listShifts: async () => mockPrismaShifts(),
      listRoles: async () => mockPrismaRoles(),
      loadCrossMonthHistory: async () => undefined,
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

function stubGenerationResult(month = 7): GenerationResult {
  return new RealScheduleEngine().generate(realisticGenerationInput({ year: 2026, month }));
}

describe("GenerateScheduleUseCase — motor REAL_V1", () => {
  it("endpoint use-case chama RealScheduleEngine (não legacy)", async () => {
    const realGenerate = vi.fn((_input: GenerationInput) => stubGenerationResult(7));
    const realEngine = { generate: realGenerate } as unknown as RealScheduleEngine;

    const { scheduleRepo, calendarRepo, preAllocRepo } = mockRepos();
    const uc = new GenerateScheduleUseCase(
      scheduleRepo as never,
      calendarRepo as never,
      preAllocRepo as never,
      realEngine,
    );

    const result = await uc.execute(2026, 7);

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
