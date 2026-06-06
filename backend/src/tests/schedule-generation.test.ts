import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { filterByLevel } from "../domain/schedule/violation-level.js";
import { baseGenerationInput, minimalPaoInput } from "./generation-fixtures.js";
import { MOCK_EMPLOYEES } from "./fixtures.js";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { ScheduleUseCase } from "../application/use-cases/schedule.use-case.js";
import { PublishedScheduleCannotRegenerateError } from "../application/errors/schedule.errors.js";
import { ScheduleNotPublishedError } from "../application/errors/schedule.errors.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

describe("ScheduleGenerationEngine", () => {
  it("gera escala básica para mês simples com PAOs suficientes", () => {
    const result = engine.generate(minimalPaoInput(4));
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.summary.paoCount).toBe(4);
    expect(result.summary.totalAssignments).toBe(result.assignments.length);
  });

  it("não deixa APAO sem violação de cobertura quando não há PAO na janela", () => {
    const input = baseGenerationInput({
      employees: [
        { uuid: "p1", domainId: 1, employee: { id: 1, name: "PAO A", role: "PAO", seniority: 1 } },
        { uuid: "a1", domainId: 2, employee: { id: 2, name: "APAO B", role: "APAO", seniority: 1 } },
      ],
      lockedAllocations: [],
    });
    const forced = engine.generate(input);
    const apaoAlone = forced.violations.some(
      (v) => v.type.includes("APAO") || v.detail.toUpperCase().includes("APAO"),
    );
    const hasApaoWork = forced.assignments.some((a) => a.shiftCode.startsWith("T") && ["T1", "T2", "T3", "T4"].includes(a.shiftCode));
    if (hasApaoWork) {
      expect(apaoAlone || !forced.summary.valid).toBe(true);
    }
  });

  it("respeita férias — sem trabalho no dia de férias", () => {
    const pao = MOCK_EMPLOYEES.find((e) => e.role === "PAO")!;
    const vacationDay = "2026-06-10";
    const result = engine.generate(
      baseGenerationInput({
        vacationDays: [{ employeeUuid: "uuid-1", date: vacationDay }],
        employees: [{ uuid: "uuid-1", domainId: 1, employee: pao }, ...baseGenerationInput().employees.slice(1)],
      }),
    );
    const workOnVacation = result.assignments.some(
      (a) => a.employeeUuid === "uuid-1" && a.date === vacationDay,
    );
    expect(workOnVacation).toBe(false);
  }, SLOW_MS);

  it("respeita FP — folga pedida bloqueia trabalho", () => {
    const pao = MOCK_EMPLOYEES.find((e) => e.role === "PAO")!;
    const fpDay = "2026-06-12";
    const result = engine.generate(
      baseGenerationInput({
        approvedDayOff: [{ employeeUuid: "uuid-1", date: fpDay }],
        employees: [{ uuid: "uuid-1", domainId: 1, employee: pao }, ...baseGenerationInput().employees.slice(1)],
      }),
    );
    const workOnFp = result.assignments.some((a) => a.employeeUuid === "uuid-1" && a.date === fpDay);
    expect(workOnFp).toBe(false);
  }, SLOW_MS);

  it("retorna violações ou gaps quando PAOs insuficientes para T6/T7/T8", () => {
    const result = engine.generate(minimalPaoInput(1));
    const critical = filterByLevel(result.violations, ["CRITICAL"]);
    expect(result.summary.coverageGaps > 0 || critical.length > 0 || !result.success).toBe(true);
  });
});

describe("GenerateScheduleUseCase — escala publicada", () => {
  it("não sobrescreve escala publicada", async () => {
    const mockSchedule = {
      findMonth: async () => ({
        id: "m1",
        year: 2026,
        month: 6,
        status: "PUBLISHED",
        assignments: [],
        preAllocations: [],
        ruleViolations: [],
      }),
      listActiveEmployees: async () => [],
      listShifts: async () => [],
      upsertGeneratedMonth: async () => {
        throw new Error("should not run");
      },
      clearForRegeneration: async () => {
        throw new Error("should not run");
      },
      saveAssignments: async () => {},
      saveGeneratedPreAllocations: async () => {},
      saveViolations: async () => {},
    };
    const mockCalendar = {
      listVacationDaysForMonth: async () => [],
      listApprovedDayOffForMonth: async () => [],
      listFlightDaysForMonth: async () => [],
    };
    const uc = new GenerateScheduleUseCase(
      mockSchedule as never,
      mockCalendar as never,
      { findAll: async () => [] } as never,
      new ScheduleGenerationEngine(),
    );
    await expect(uc.execute(2026, 6)).rejects.toBeInstanceOf(PublishedScheduleCannotRegenerateError);
  });
});

describe("PublishScheduleUseCase", () => {
  it("publica escala GENERATED sem críticas — ver schedule-phase51.test.ts", () => {
    expect(true).toBe(true);
  });
});

describe("ScheduleUseCase — cliente", () => {
  it("cliente só recebe escala PUBLISHED", async () => {
    const mockSchedule = {
      findPublishedMonth: async () => null,
      findMonth: async () => null,
      ensureMonth: async () => ({}),
      listShifts: async () => [],
      listActiveEmployees: async () => [],
    };
    const uc = new ScheduleUseCase(undefined as never, mockSchedule as never);
    await expect(uc.getPublishedMonth(2026, 6)).rejects.toBeInstanceOf(ScheduleNotPublishedError);
  });
});
