import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { buildContextFromDbParts } from "../infrastructure/mappers/schedule-context.mapper.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { listPaoCoverageGaps } from "../domain/rules/coverage.js";
import { runFinalCoverageGate } from "../domain/rules/coverage-gate.js";
import { addDays } from "../domain/rules/dates.js";
import { ClearGeneratedScheduleUseCase } from "../application/use-cases/clear-generated-schedule.use-case.js";
import { PublishedScheduleCannotBeClearedError } from "../application/errors/schedule.errors.js";
import { realisticGenerationInput, REALISTIC_TEST_MONTH, REALISTIC_TEST_YEAR } from "./realistic-fixtures.js";
import { mockPreAllocationRow } from "./pre-allocation-fixtures.js";
import type { Employee } from "@prisma/client";const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function paoUuid(index: number): string {
  return `real-${index + 1}`;
}

describe("Calibração do motor", () => {
  it(
    "1. dias livres geram DISPONÍVEL PARA VOO (INFO, sem ND artificial)",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
      const disponivel = validateSchedule(ctx).filter((v) => v.type === "DISPONÍVEL PARA VOO");
      const hasArtificialNd = result.allocations.some((a) => {
        if (a.label !== "ND") return false;
        const d1 = addDays(a.date, -2);
        const d2 = addDays(a.date, -1);
        const t8pair = result.assignments.some(
          (x) => x.employeeUuid === a.employeeUuid && x.date === d1 && x.shiftCode === "T8",
        ) && result.assignments.some(
          (x) => x.employeeUuid === a.employeeUuid && x.date === d2 && x.shiftCode === "T8",
        );
        return !t8pair;
      });
      expect(hasArtificialNd).toBe(false);
      expect(disponivel.every((v) => v.level === "INFO")).toBe(true);
      const paoDisp = result.summary.operationalByEmployee
        ?.filter((e) => e.type === "PAO")
        .reduce((n, e) => n + e.disponivel, 0);
      expect(paoDisp).toBeGreaterThanOrEqual(disponivel.length);
      expect(result.summary.operationalTotals?.totalDisponiveis).toBeGreaterThanOrEqual(disponivel.length);
    },
    SLOW_MS,
  );

  it(
    "2. REAL_V1 não preenche folga comum automaticamente",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const pao = input.employees.find((e) => e.employee.role === "PAO")!;
      const common = result.allocations.filter(
        (a) => a.employeeUuid === pao.uuid && a.label === "FOLGA",
      ).length;
      expect(common).toBe(0);
      const report = result.summary.realMotorReport as { emptyDaysLeftForManualEditing?: number };
      expect(report.emptyDaysLeftForManualEditing).toBeGreaterThan(0);
    },
    SLOW_MS,
  );

  it("3. REAL_V1 gera 1 par FS por PAO", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    for (const e of input.employees.filter((x) => x.employee.role === "PAO")) {
      const fs = result.allocations.filter(
        (a) => a.employeeUuid === e.uuid && a.label === "FOLGA SOCIAL",
      ).length;
      expect(fs).toBe(2);
    }
  });

  it("4. REAL_V1 deixa dias vazios para folga manual", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const emptyCells = result.allocations.filter((a) => a.label === "FOLGA").length;
    expect(emptyCells).toBe(0);
    expect(result.summary.realMotorReport?.emptyDaysLeftForManualEditing).toBeGreaterThan(0);
  });

  it("5. FP sábado+domingo conta como folga social", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [
        { employeeUuid: paoUuid(0), date: "2026-06-06" },
        { employeeUuid: paoUuid(0), date: "2026-06-07" },
      ],
    });
    const result = engine.generate(input);
    expect(
      result.allocations.filter(
        (a) => a.employeeUuid === paoUuid(0) && a.label === "FOLGA SOCIAL",
      ).length,
    ).toBe(2);
  });

  it(
    "6. Gerar escala PAO não aloca APAO (motor APAO dedicado)",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const apaos = input.employees.filter((e) => e.employee.role === "APAO");
      for (const e of apaos) {
        const count = result.assignments.filter((a) => a.employeeUuid === e.uuid).length;
        expect(count).toBe(0);
      }
    },
    SLOW_MS,
  );

  it(
    "7. APAO nunca sozinho (sem violação APAO SEM PAO)",
    () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(validateSchedule(ctx).some((v) => v.type === "APAO SEM PAO")).toBe(false);
  },
    SLOW_MS,
  );

  it(
    "8. pré-alocações VOO/SIMULADOR/CURSO/CMA/OUTRO aparecem na escala",
    () => {
    const cases = [
      { uuid: paoUuid(0), day: "2026-06-05", label: "VOO" },
      { uuid: paoUuid(1), day: "2026-06-06", label: "SIMULADOR" },
      { uuid: paoUuid(2), day: "2026-06-07", label: "CURSO" },
      { uuid: paoUuid(3), day: "2026-06-08", label: "CMA" },
      { uuid: paoUuid(4), day: "2026-06-09", label: "OUTRO" },
    ] as const;

    for (const c of cases) {
      const result = engine.generate(
        realisticGenerationInput({
          lockedAllocations: [{ employeeUuid: c.uuid, date: c.day, label: c.label }],
        }),
      );
      const expectedLabel = c.label === "CURSO" ? "CURSO ONLINE" : c.label;
      expect(
        result.allocations.some(
          (a) => a.employeeUuid === c.uuid && a.date === c.day && a.label === expectedLabel,
        ),
      ).toBe(true);
      expect(result.assignments.some((a) => a.employeeUuid === c.uuid && a.date === c.day)).toBe(
        false,
      );
    }
  },
    SLOW_MS,
  );

  it(
    "9. validator e summary usam mesma cobertura (sem COVERAGE_MISSING falso)",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
      const gateGaps = runFinalCoverageGate(ctx).gaps;
      const wsGaps = result.summary.coverageGaps ?? result.summary.coverageMissingCount ?? 0;
      expect(gateGaps).toBe(wsGaps);

      const coverageViolations = validateSchedule(ctx).filter((v) =>
        v.type.startsWith("COVERAGE_MISSING"),
      );
      expect(coverageViolations.length).toBe(gateGaps);
    },
    SLOW_MS,
  );

  it(
    "10. buildContextFromDbParts alinha IDs com generationToScheduleContext",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const genCtx = generationToScheduleContext(input, result.assignments, result.allocations);

      const employees = input.employees.map((e) => ({
        id: e.uuid,
        name: e.employee.name,
        type: e.employee.role as Employee["type"],
        roleId: null,
        seniorityNumber: e.employee.seniority,
        birthDate: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const { context: dbCtx } = buildContextFromDbParts({
        year: REALISTIC_TEST_YEAR,
        month: REALISTIC_TEST_MONTH,
        employees,
        shifts: input.shifts.map((s, i) => ({
          id: `shift-${i}`,
          code: s.code,
          name: s.name ?? s.code,
          startTime: s.startTime,
          endTime: s.endTime,
          durationHours: 8,
          employeeTypeAllowed: (s.role === "PAO" || s.role === "APAO" ? s.role : "PAO") as "PAO" | "APAO",
          active: true,
          displayOrder: i + 1,
          mandatoryCoverage: ["T6", "T7", "T8"].includes(s.code),
          requiresT8PairNd: s.code === "T8",
          coverageType: "REQUIRED" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        assignments: result.assignments.map((a) => {
          const emp = employees.find((e) => e.id === a.employeeUuid)!;
          return {
            id: `asg-${a.employeeUuid}-${a.date}`,
            scheduleMonthId: "m1",
            employeeId: a.employeeUuid,
            date: new Date(`${a.date}T12:00:00.000Z`),
            shiftCode: a.shiftCode,
            label: null,
            source: "GENERATOR" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
            employee: emp,
          };
        }),
        preAllocations: result.allocations.map((a) => {
          const emp = employees.find((e) => e.id === a.employeeUuid)!;
          return mockPreAllocationRow(
            {
              id: `pre-${a.employeeUuid}-${a.date}`,
              scheduleMonthId: "m1",
              employeeId: a.employeeUuid,
              date: new Date(`${a.date}T12:00:00.000Z`),
              label: a.label,
              startTime: a.startTime ?? null,
              endTime: a.endTime ?? null,
            },
            emp,
          );
        }),      });

      expect(listPaoCoverageGaps(dbCtx).length).toBe(listPaoCoverageGaps(genCtx).length);
      expect(
        validateSchedule(dbCtx).filter((v) => v.type === "FOLGAS PAO").length,
      ).toBe(validateSchedule(genCtx).filter((v) => v.type === "FOLGAS PAO").length);
    },
    SLOW_MS,
  );
});

describe("Limpar geração", () => {
  it("bloqueia limpeza de escala publicada", async () => {
    const useCase = new ClearGeneratedScheduleUseCase({
      findMonthById: async () => ({
        id: "m1",
        year: 2026,
        month: 6,
        status: "PUBLISHED",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
        preAllocations: [],
        ruleViolations: [],
      }),
      clearGeneratedData: async () => {
        throw new Error("should not run");
      },
    } as never);

    await expect(useCase.execute("m1")).rejects.toBeInstanceOf(PublishedScheduleCannotBeClearedError);
  });

  it("permite limpar em status DRAFT", async () => {
    let cleared = false;
    const useCase = new ClearGeneratedScheduleUseCase({
      findMonthById: async () => ({
        id: "m1",
        year: 2026,
        month: 7,
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
        preAllocations: [],
        ruleViolations: [],
      }),
      clearGeneratedData: async () => {
        cleared = true;
        return {
          id: "m1",
          year: 2026,
          month: 7,
          status: "DRAFT",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    } as never);

    const result = await useCase.execute("m1");
    expect(cleared).toBe(true);
    expect(result.status).toBe("DRAFT");
  });

  it("limpa turnos, folgas e voos — mês volta para DRAFT", async () => {
    let cleared = false;
    const useCase = new ClearGeneratedScheduleUseCase({
      findMonthById: async () => ({
        id: "m1",
        year: 2026,
        month: 6,
        status: "GENERATED",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignments: [],
        preAllocations: [],
        ruleViolations: [],
      }),
      clearGeneratedData: async () => {
        cleared = true;
        return {
          id: "m1",
          year: 2026,
          month: 6,
          status: "DRAFT",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    } as never);

    const result = await useCase.execute("m1");
    expect(cleared).toBe(true);
    expect(result.status).toBe("DRAFT");
  });
});
