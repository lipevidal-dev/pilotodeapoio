import { describe, expect, it, vi } from "vitest";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { SchedulePersistenceValidationError } from "../application/errors/schedule.errors.js";
import type { GenerationInput, GenerationResult } from "../domain/schedule/generation-types.js";
import { validateGenerationBeforeSave } from "../domain/schedule/schedule-generation-validators.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import {
  mockPrismaEmployeesFromRealistic,
  mockPrismaRoles,
  mockPrismaShifts,
} from "./helpers/generate-schedule-mocks.js";

function mockRepos() {
  return {
    scheduleRepo: {
      findMonth: vi.fn(async () => null),
      listActiveEmployees: vi.fn(async () => mockPrismaEmployeesFromRealistic()),
      listShifts: vi.fn(async () => mockPrismaShifts()),
      listRoles: vi.fn(async () => mockPrismaRoles()),
      loadCrossMonthHistory: vi.fn(async () => undefined),
      listShiftRestrictionsForMonth: vi.fn(async () => []),
      listPreferredShiftsForMonth: vi.fn(async () => []),
      listNoFlightDatesForMonth: vi.fn(async () => []),
      upsertGeneratedMonth: vi.fn(async () => ({ id: "month-1" })),
      clearForRegeneration: vi.fn(async () => {}),
      saveAssignments: vi.fn(async () => {}),
      saveGeneratedPreAllocations: vi.fn(async () => {}),
      saveViolations: vi.fn(async () => {}),
    },
    calendarRepo: {
      listVacationDaysForMonth: vi.fn(async () => []),
      listVacationReturnDaysForMonth: vi.fn(async () => []),
      listApprovedDayOffForMonth: vi.fn(async () => []),
      listFlightDaysForMonth: vi.fn(async () => []),
    },
    preAllocRepo: {
      findAll: vi.fn(async () => []),
    },
  };
}

function validGenerationResult(input: GenerationInput): GenerationResult {
  return new RealScheduleEngine().generate(input);
}

describe("validateGenerationBeforeSave — bloqueios estruturais", () => {
  const input = realisticGenerationInput({ year: 2026, month: 7 });

  it("julho/2026 fixture passa validateBeforeSave", () => {
    const generated = validGenerationResult(input);
    const validation = validateGenerationBeforeSave(input, generated);
    expect(validation.criticalCount).toBe(0);
  });

  it("rejeita ND contado como turno", () => {
    const valid = validGenerationResult(input);
    const bad: GenerationResult = {
      ...valid,
      assignments: [
        ...valid.assignments,
        { employeeUuid: "real-1", date: "2026-07-15", shiftCode: "ND" },
      ],
    };
    const validation = validateGenerationBeforeSave(input, bad);
    expect(validation.criticalCount).toBeGreaterThan(0);
    expect(validation.issues.some((i) => i.type === "ND_AS_SHIFT")).toBe(true);
  });

  it("rejeita turno duplicado no mesmo dia", () => {
    const valid = validGenerationResult(input);
    const first = valid.assignments[0]!;
    const bad: GenerationResult = {
      ...valid,
      assignments: [
        ...valid.assignments,
        { employeeUuid: first.employeeUuid, date: first.date, shiftCode: "T7" },
      ],
    };
    const validation = validateGenerationBeforeSave(input, bad);
    expect(validation.criticalCount).toBeGreaterThan(0);
    expect(validation.issues.some((i) => i.type === "DUPLICATE_ASSIGNMENT")).toBe(true);
  });

  it("rejeita gap de cobertura T6", () => {
    const valid = validGenerationResult(input);
    const bad: GenerationResult = {
      ...valid,
      assignments: valid.assignments.filter(
        (a) => !(a.date === "2026-07-01" && a.shiftCode === "T6"),
      ),
    };
    const validation = validateGenerationBeforeSave(input, bad);
    expect(validation.criticalCount).toBeGreaterThan(0);
    expect(validation.issues.some((i) => i.type === "COVERAGE_GAP")).toBe(true);
  });

  it("rejeita pré-alocação admin sobrescrita", () => {
    const lockedInput = realisticGenerationInput({
      year: 2026,
      month: 7,
      lockedAllocations: [{ employeeUuid: "real-1", date: "2026-07-10", label: "T6" }],
    });
    const valid = validGenerationResult(lockedInput);
    const bad: GenerationResult = {
      ...valid,
      assignments: valid.assignments.map((a) =>
        a.employeeUuid === "real-1" && a.date === "2026-07-10"
          ? { ...a, shiftCode: "T7" }
          : a,
      ),
    };
    const validation = validateGenerationBeforeSave(lockedInput, bad);
    expect(validation.criticalCount).toBeGreaterThan(0);
    expect(validation.issues.some((i) => i.type === "PREALLOC_SHIFT_MISSING")).toBe(true);
  });
});

describe("GenerateScheduleUseCase — validateBeforeSave antes de persistir", () => {
  it("não persiste quando validateBeforeSave falha", async () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const valid = validGenerationResult(input);
    const bad: GenerationResult = {
      ...valid,
      assignments: [
        ...valid.assignments,
        { employeeUuid: "real-1", date: "2026-07-20", shiftCode: "ND" },
      ],
    };

    const mocks = mockRepos();
    const engine = { generate: vi.fn(() => bad) };
    const uc = new GenerateScheduleUseCase(
      mocks.scheduleRepo as never,
      mocks.calendarRepo as never,
      mocks.preAllocRepo as never,
      engine as never,
    );

    await expect(uc.execute(2026, 7)).rejects.toBeInstanceOf(SchedulePersistenceValidationError);
    expect(mocks.scheduleRepo.saveAssignments).not.toHaveBeenCalled();
    expect(mocks.scheduleRepo.upsertGeneratedMonth).not.toHaveBeenCalled();
  });

  it("persiste escala válida após validateBeforeSave", async () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const valid = validGenerationResult(input);
    const mocks = mockRepos();
    const engine = { generate: vi.fn(() => valid) };
    const uc = new GenerateScheduleUseCase(
      mocks.scheduleRepo as never,
      mocks.calendarRepo as never,
      mocks.preAllocRepo as never,
      engine as never,
    );

    const result = await uc.execute(2026, 7);
    expect(result.assignmentsCreated).toBeGreaterThan(0);
    expect(mocks.scheduleRepo.upsertGeneratedMonth).toHaveBeenCalled();
    expect(mocks.scheduleRepo.saveAssignments).toHaveBeenCalled();
  });
});
