import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { evaluatePublishReadiness } from "../domain/schedule/schedule-publish-guard.js";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import type { Employee } from "@prisma/client";
import type { GenerationInput } from "../domain/schedule/generation-types.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function paoUuid(index: number): string {
  return `real-${index + 1}`;
}

function operationalInput(overrides: Partial<GenerationInput>): GenerationInput {
  return realisticGenerationInput(overrides);
}

describe("Cadastros operacionais — motor", () => {
  it("1. férias impedem T6/T7/T8 no período", () => {
    const vacationDay = "2026-06-10";
    const result = engine.generate(
      operationalInput({
        vacationDays: [{ employeeUuid: paoUuid(0), date: vacationDay }],
      }),
    );
    expect(
      result.assignments.some((a) => a.employeeUuid === paoUuid(0) && a.date === vacationDay),
    ).toBe(false);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === vacationDay && a.label === "FÉRIAS",
      ),
    ).toBe(true);
  });

  it("2. FP aprovada impede turno na data", () => {
    const fpDay = "2026-06-12";
    const result = engine.generate(
      operationalInput({
        approvedDayOff: [{ employeeUuid: paoUuid(1), date: fpDay }],
      }),
    );
    expect(
      result.assignments.some((a) => a.employeeUuid === paoUuid(1) && a.date === fpDay),
    ).toBe(false);
    expect(
      result.allocations.some(
        (a) =>
          a.employeeUuid === paoUuid(1) && a.date === fpDay && a.label === "FOLGA PEDIDA",
      ),
    ).toBe(true);
  });

  it("3. VOO impede turno comum e não é sobrescrito pelo reparo", () => {
    const vooDay = "2026-06-08";
    const result = engine.generate(
      operationalInput({
        flightDays: [{ employeeUuid: paoUuid(2), date: vooDay }],
      }),
    );
    expect(
      result.assignments.some((a) => a.employeeUuid === paoUuid(2) && a.date === vooDay),
    ).toBe(false);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(2) && a.date === vooDay && a.label === "VOO",
      ),
    ).toBe(true);
  });

  it("4. SIMULADOR impede turno comum na data", () => {
    const day = "2026-06-09";
    const result = engine.generate(
      operationalInput({
        lockedAllocations: [{ employeeUuid: paoUuid(3), date: day, label: "SIMULADOR" }],
      }),
    );
    expect(
      result.assignments.some((a) => a.employeeUuid === paoUuid(3) && a.date === day),
    ).toBe(false);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(3) && a.date === day && a.label === "SIMULADOR",
      ),
    ).toBe(true);
  });

  it("5. CURSO (cadastro) impede turno comum na data", () => {
    const day = "2026-06-11";
    const result = engine.generate(
      operationalInput({
        lockedAllocations: [{ employeeUuid: paoUuid(4), date: day, label: "CURSO" }],
      }),
    );
    expect(
      result.assignments.some((a) => a.employeeUuid === paoUuid(4) && a.date === day),
    ).toBe(false);
    expect(
      result.allocations.some(
        (a) =>
          a.employeeUuid === paoUuid(4) && a.date === day && a.label === "CURSO ONLINE",
      ),
    ).toBe(true);
  }, SLOW_MS);

  it("6. pré-alocação manual aparece na escala gerada", () => {
    const day = "2026-06-14";
    const result = engine.generate(
      operationalInput({
        lockedAllocations: [{ employeeUuid: paoUuid(5), date: day, label: "CMA" }],
      }),
    );
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(5) && a.date === day && a.label === "CMA",
      ),
    ).toBe(true);
  });

  it(
    "7–9. conflito turno x bloqueio gera CRITICAL e bloqueia publicação",
    () => {
      const input = operationalInput({
        vacationDays: [{ employeeUuid: paoUuid(0), date: "2026-06-15" }],
      });
      const result = engine.generate(input);
      const ctx = generationToScheduleContext(input, result.assignments, result.allocations);

      const onVacation = result.assignments.filter(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-15",
      );
      expect(onVacation.length).toBe(0);

      const publish = evaluatePublishReadiness(ctx);
      expect(publish.canPublish).toBe(result.summary.criticalCount === 0);
    },
    SLOW_MS,
  );
});

describe("GenerateScheduleUseCase — persistência de cadastros operacionais", () => {
  it("persiste férias, FP e VOO em preAllocations (não pula bloqueios de calendário)", async () => {
    const empId = "emp-pao-1";
    const employees: Employee[] = [
      {
        id: empId,
        name: "PAO Test",
        type: "PAO",
        roleId: null,
        birthDate: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    let savedAllocations: Array<{ employeeUuid: string; date: string; label: string }> = [];
    let skipKeysUsed = new Set<string>();

    const useCase = new GenerateScheduleUseCase(
      {
        findMonth: async () => null,
        listActiveEmployees: async () => employees,
        loadCrossMonthHistory: async () => ({ assignments: [], allocations: [] }),
        listShiftRestrictionsForMonth: async () => [],
        listRoles: async () => [
          {
            id: "role-pao",
            name: "Piloto de Apoio Operacional",
            code: "PAO",
            description: null,
            active: true,
            displayOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        listShifts: async () => [
          {
            id: "s1",
            code: "T6",
            name: "T6",
            startTime: "06:00",
            endTime: "14:00",
            durationHours: 8,
            employeeTypeAllowed: "PAO",
            active: true,
            displayOrder: 1,
            mandatoryCoverage: true,
            requiresT8PairNd: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "s2",
            code: "T7",
            name: "T7",
            startTime: "14:00",
            endTime: "22:00",
            durationHours: 8,
            employeeTypeAllowed: "PAO",
            active: true,
            displayOrder: 2,
            mandatoryCoverage: true,
            requiresT8PairNd: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "s3",
            code: "T8",
            name: "T8",
            startTime: "22:00",
            endTime: "06:00",
            durationHours: 8,
            employeeTypeAllowed: "PAO",
            active: true,
            displayOrder: 3,
            mandatoryCoverage: true,
            requiresT8PairNd: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        upsertGeneratedMonth: async () => ({
          id: "month-1",
          year: 2026,
          month: 6,
          status: "GENERATED",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        clearForRegeneration: async () => {},
        saveAssignments: async () => {},
        saveGeneratedPreAllocations: async (
          _id: string,
          rows: Array<{ employeeUuid: string; date: string; label: string }>,
          skip: Set<string>,
        ) => {
          savedAllocations = rows;
          skipKeysUsed = skip;
        },
        saveViolations: async () => {},
      } as never,
      {
        listVacationDaysForMonth: async () => [
          { employeeUuid: empId, date: "2026-06-10" },
        ],
        listVacationReturnDaysForMonth: async () => [],
        listApprovedDayOffForMonth: async () => [
          { employeeUuid: empId, date: "2026-06-12" },
        ],
        listFlightDaysForMonth: async () => [
          { employeeUuid: empId, date: "2026-06-18" },
        ],
      } as never,
      {
        findAll: async () => [
          {
            id: "pre-1",
            scheduleMonthId: "month-1",
            employeeId: empId,
            date: new Date("2026-06-20T12:00:00.000Z"),
            label: "SIMULADOR",
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            employee: employees[0],
            scheduleMonth: {
              id: "month-1",
              year: 2026,
              month: 6,
              status: "DRAFT",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      } as never,
      engine,
    );

    await useCase.execute(2026, 6);

    expect(savedAllocations.some((a) => a.label === "FÉRIAS" && a.date === "2026-06-10")).toBe(
      true,
    );
    expect(
      savedAllocations.some((a) => a.label === "FOLGA PEDIDA" && a.date === "2026-06-12"),
    ).toBe(true);
    expect(savedAllocations.some((a) => a.label === "VOO" && a.date === "2026-06-18")).toBe(true);
    expect(
      savedAllocations.some((a) => a.label === "SIMULADOR" && a.date === "2026-06-20"),
    ).toBe(true);

    expect(skipKeysUsed.has(`${empId}|2026-06-20`)).toBe(true);
    expect(skipKeysUsed.has(`${empId}|2026-06-10`)).toBe(false);
    expect(skipKeysUsed.has(`${empId}|2026-06-12`)).toBe(false);
    expect(skipKeysUsed.has(`${empId}|2026-06-18`)).toBe(false);
  });
});
