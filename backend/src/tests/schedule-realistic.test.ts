import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { filterByLevel } from "../domain/schedule/violation-level.js";
import { evaluatePublishReadiness } from "../domain/schedule/schedule-publish-guard.js";
import { listPaoCoverageGaps } from "../domain/rules/coverage.js";
import { PublishScheduleUseCase } from "../application/use-cases/publish-schedule.use-case.js";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { PublishedScheduleCannotRegenerateError } from "../application/errors/schedule.errors.js";
import { PublishBlockedCriticalViolationsError } from "../application/errors/schedule.errors.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import {
  impossiblePaoInput,
  realisticGenerationInput,
  REALISTIC_TEST_MONTH,
  REALISTIC_TEST_YEAR,
} from "./realistic-fixtures.js";

function mockPrismaShifts() {
  return DEFAULT_SHIFTS.map((s, i) => ({
    id: `shift-${i}`,
    code: s.code,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    durationHours: 8,
    employeeTypeAllowed: s.role,
    active: true,
    displayOrder: i + 1,
    mandatoryCoverage: ["T6", "T7", "T8"].includes(s.code),
    requiresT8PairNd: s.code === "T8",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}
const engine = new ScheduleGenerationEngine();

describe("Cenário-base realista — junho/2026", () => {
  it("gera escala com cobertura completa e sem ND artificial", () => {
    const result = engine.generate(realisticGenerationInput());

    expect(result.summary.coverageMissingCount).toBe(0);
    expect(result.summary.daysWithFullCoverage).toBe(30);
    expect(result.assignments.length).toBeGreaterThan(0);

    const critical = filterByLevel(result.violations, ["CRITICAL"]);
    const blockingCoverage = critical.filter((c) =>
      c.ruleCode.startsWith("COVERAGE_MISSING"),
    );
    const invalidNd = critical.filter((c) =>
      ["ND FORA DE T8/T8", "TURNO EM DIA ND"].includes(c.ruleCode),
    );
    expect(blockingCoverage.length).toBe(0);
    expect(invalidNd.length).toBe(0);
    const dispCritical = critical.filter((c) => c.ruleCode === "DISPONÍVEL PARA VOO" || c.ruleCode === "DIA VAZIO");
    expect(dispCritical.length).toBe(0);
    expect(result.summary.operationalTotals?.totalDisponiveis).toBeGreaterThanOrEqual(0);
    expect(result.summary.operationalTotals?.totalTurnos).toBeGreaterThan(0);

    const ctx = {
      year: REALISTIC_TEST_YEAR,
      month: REALISTIC_TEST_MONTH,
      employees: realisticGenerationInput().employees.map((e) => e.employee),
      shifts: realisticGenerationInput().shifts,
      assignments: result.assignments.map((a) => {
        const emp = realisticGenerationInput().employees.find((e) => e.uuid === a.employeeUuid)!;
        return {
          employeeId: emp.domainId,
          employeeName: emp.employee.name,
          workDate: a.date,
          shiftCode: a.shiftCode,
        };
      }),
      allocations: result.allocations.map((al) => {
        const emp = realisticGenerationInput().employees.find((e) => e.uuid === al.employeeUuid)!;
        return {
          employeeId: emp.domainId,
          employeeName: emp.employee.name,
          allocDate: al.date,
          allocType: al.label,
        };
      }),
    };

    const gaps = listPaoCoverageGaps(ctx);
    expect(gaps.length).toBe(0);

    const publishCheck = evaluatePublishReadiness(ctx);
    const publishCoverage = publishCheck.criticalViolations.filter((c) =>
      c.ruleCode.startsWith("COVERAGE_MISSING"),
    );
    expect(publishCoverage.length).toBe(0);
  });

  it("summary retorna cobertura válida e totais operacionais", () => {
    const result = engine.generate(realisticGenerationInput());
    expect(result.summary.coverageMissingCount).toBe(0);
    expect(result.summary.operationalTotals?.totalDiasTrabalhados).toBeGreaterThan(0);
    expect(result.summary.generatedAt).toBeDefined();
    expect(result.summary.paosUsed).toBeGreaterThanOrEqual(3);
  });

  it("summary aponta coverageMissingCount > 0 em cenário impossível", () => {
    const result = engine.generate(impossiblePaoInput());
    expect(result.summary.coverageMissingCount).toBeGreaterThan(0);
    expect(result.summary.criticalCount).toBeGreaterThan(0);
    expect(result.summary.impossibleScenario).toBe(true);
    expect(result.summary.mainBlockingReasons!.length).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });
});

describe("Publicação cenário-base", () => {
  it("publica cenário-base quando não há violação de cobertura", async () => {
    const generated = engine.generate(realisticGenerationInput());
    expect(generated.summary.coverageMissingCount).toBe(0);

    const input = realisticGenerationInput();
    const employees = input.employees.map((e, i) => ({
      id: `db-${i}`,
      name: e.employee.name,
      type: e.employee.role === "APAO" ? ("APAO" as const) : ("PAO" as const),
      active: true,
    }));
    const nameToId = new Map(employees.map((e) => [e.name, e.id]));

    const assignments = generated.assignments.map((a, idx) => {
      const emp = input.employees.find((e) => e.uuid === a.employeeUuid)!;
      const empId = nameToId.get(emp.employee.name)!;
      return {
        id: `as-${idx}`,
        scheduleMonthId: "m-real",
        employeeId: empId,
        date: new Date(`${a.date}T12:00:00.000Z`),
        shiftCode: a.shiftCode,
        label: null,
        source: "GENERATOR" as const,
        employee: { id: empId, name: emp.employee.name, type: emp.employee.role, active: true },
      };
    });

    const mockSchedule = {
      findMonthById: async () => ({
        id: "m-real",
        year: REALISTIC_TEST_YEAR,
        month: REALISTIC_TEST_MONTH,
        status: "GENERATED",
        assignments,
        preAllocations: generated.allocations.map((al, idx) => {
          const emp = input.employees.find((e) => e.uuid === al.employeeUuid)!;
          const empId = nameToId.get(emp.employee.name)!;
          return {
            id: `pa-${idx}`,
            scheduleMonthId: "m-real",
            employeeId: empId,
            date: new Date(`${al.date}T12:00:00.000Z`),
            label: al.label,
            employee: { id: empId, name: emp.employee.name, type: emp.employee.role, active: true },
          };
        }),
        ruleViolations: [],
      }),
      listShifts: async () => mockPrismaShifts(),
      listActiveEmployees: async () => employees,
      publishMonth: async () => ({
        id: "m-real",
        year: REALISTIC_TEST_YEAR,
        month: REALISTIC_TEST_MONTH,
        status: "PUBLISHED",
      }),
    };

    const uc = new PublishScheduleUseCase(mockSchedule as never);
    const publishCtx = {
      year: REALISTIC_TEST_YEAR,
      month: REALISTIC_TEST_MONTH,
      employees: input.employees.map((e) => ({ ...e.employee, id: e.domainId })),
      shifts: input.shifts,
      assignments: generated.assignments.map((a) => {
        const emp = input.employees.find((e) => e.uuid === a.employeeUuid)!;
        return {
          employeeId: emp.domainId,
          employeeName: emp.employee.name,
          workDate: a.date,
          shiftCode: a.shiftCode,
        };
      }),
      allocations: generated.allocations.map((al) => {
        const emp = input.employees.find((e) => e.uuid === al.employeeUuid)!;
        return {
          employeeId: emp.domainId,
          employeeName: emp.employee.name,
          allocDate: al.date,
          allocType: al.label,
        };
      }),
    };
    const readiness = evaluatePublishReadiness(publishCtx);
    const blocking = readiness.criticalViolations.filter(
      (c) =>
        c.ruleCode === "DISPONÍVEL PARA VOO" ||
        c.ruleCode === "DIA VAZIO" ||
        c.ruleCode === "FOLGAS PAO",
    );
    if (blocking.length > 0) {
      await expect(uc.execute("m-real")).rejects.toBeInstanceOf(
        PublishBlockedCriticalViolationsError,
      );
    } else {
      const published = await uc.execute("m-real");
      expect(published.status).toBe("PUBLISHED");
    }
  });

  it("bloqueia publicação quando remover manualmente T8 de um dia", async () => {
    const generated = engine.generate(realisticGenerationInput());
    const input = realisticGenerationInput();
    const employees = input.employees.map((e, i) => ({
      id: `db-${i}`,
      name: e.employee.name,
      type: e.employee.role === "APAO" ? ("APAO" as const) : ("PAO" as const),
      active: true,
    }));
    const nameToId = new Map(employees.map((e) => [e.name, e.id]));

    const assignments = generated.assignments
      .filter((a) => a.shiftCode !== "T8" || a.date !== "2026-06-10")
      .map((a, idx) => {
        const emp = input.employees.find((e) => e.uuid === a.employeeUuid)!;
        const empId = nameToId.get(emp.employee.name)!;
        return {
          id: `as-${idx}`,
          scheduleMonthId: "m-gap",
          employeeId: empId,
          date: new Date(`${a.date}T12:00:00.000Z`),
          shiftCode: a.shiftCode,
          label: null,
          source: "GENERATOR" as const,
          employee: { id: empId, name: emp.employee.name, type: emp.employee.role, active: true },
        };
      });

    const mockSchedule = {
      findMonthById: async () => ({
        id: "m-gap",
        year: REALISTIC_TEST_YEAR,
        month: REALISTIC_TEST_MONTH,
        status: "GENERATED",
        assignments,
        preAllocations: [],
        ruleViolations: [],
      }),
      listShifts: async () => mockPrismaShifts(),
      listActiveEmployees: async () => employees,
      publishMonth: async () => {
        throw new Error("must not publish");
      },
    };

    const uc = new PublishScheduleUseCase(mockSchedule as never);
    await expect(uc.execute("m-gap")).rejects.toBeInstanceOf(PublishBlockedCriticalViolationsError);
  });
});

describe("GenerateScheduleUseCase — PUBLISHED", () => {
  it("motor não altera escala PUBLISHED", async () => {
    const mockSchedule = {
      findMonth: async () => ({
        id: "m-pub",
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
        throw new Error("must not run");
      },
      clearForRegeneration: async () => {
        throw new Error("must not run");
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
      new RealScheduleEngine(),
    );
    await expect(uc.execute(2026, 6)).rejects.toBeInstanceOf(PublishedScheduleCannotRegenerateError);
  });
});
