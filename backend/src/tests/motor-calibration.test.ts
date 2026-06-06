import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { buildContextFromDbParts } from "../infrastructure/mappers/schedule-context.mapper.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { listPaoCoverageGaps } from "../domain/rules/coverage.js";
import { runFinalCoverageGate } from "../domain/rules/coverage-gate.js";
import { addDays, iterDays } from "../domain/rules/dates.js";
import { IDEAL_PAO_REST_COUNT, MAX_PAO_REST_COUNT, PAO_REST_TYPES } from "../domain/rules/constants.js";
import { ClearGeneratedScheduleUseCase } from "../application/use-cases/clear-generated-schedule.use-case.js";
import {
  PublishedScheduleCannotBeClearedError,
  ScheduleNotGeneratedError,
} from "../application/errors/schedule.errors.js";
import { realisticGenerationInput, REALISTIC_TEST_MONTH, REALISTIC_TEST_YEAR } from "./realistic-fixtures.js";
import type { Employee } from "@prisma/client";
const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function paoUuid(index: number): string {
  return `real-${index + 1}`;
}

function folgaIndices(uuid: string, allocations: { employeeUuid: string; date: string; label: string }[], days: string[]): number[] {
  const restSet = new Set(PAO_REST_TYPES.map((t) => t.toUpperCase()));
  return allocations
    .filter((a) => a.employeeUuid === uuid && restSet.has(a.label.toUpperCase()))
    .map((a) => days.indexOf(a.date))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
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
      expect(paoDisp).toBe(disponivel.length);
      expect(result.summary.operationalTotals?.totalDisponiveis).toBeGreaterThanOrEqual(disponivel.length);
    },
    SLOW_MS,
  );

  it(
    "2. folgas PAO distribuídas (não concentradas no início)",
    () => {
      const input = realisticGenerationInput();
      const days = iterDays(input.year, input.month);
      const result = engine.generate(input);
      const pao = input.employees.find((e) => e.employee.role === "PAO")!;
      const indices = folgaIndices(pao.uuid, result.allocations, days);
      expect(indices.length).toBeGreaterThanOrEqual(IDEAL_PAO_REST_COUNT);
      expect(indices.length).toBeLessThanOrEqual(MAX_PAO_REST_COUNT);
      if (indices.length >= 4) {
        const spread = indices[indices.length - 1] - indices[0];
        expect(spread).toBeGreaterThan(10);
      }
    },
    SLOW_MS,
  );

  it("3. 10 ou 11 folgas por PAO (ideal 10, até 11 permitido)", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    for (const e of input.employees.filter((x) => x.employee.role === "PAO")) {
      const n = result.allocations.filter(
        (a) =>
          a.employeeUuid === e.uuid &&
          PAO_REST_TYPES.map((t) => t.toUpperCase()).includes(a.label.toUpperCase()),
      ).length;
      expect(n).toBeGreaterThanOrEqual(IDEAL_PAO_REST_COUNT);
      expect(n).toBeLessThanOrEqual(MAX_PAO_REST_COUNT);
    }
  });

  it("4. folga social mensal por PAO", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    for (const e of input.employees.filter((x) => x.employee.role === "PAO")) {
      const fs = result.allocations.filter(
        (a) => a.employeeUuid === e.uuid && a.label === "FOLGA SOCIAL",
      );
      expect(fs.length).toBeGreaterThanOrEqual(2);
    }
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
    "6. APAOs ativos recebem carga de turnos",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const apaos = input.employees.filter((e) => e.employee.role === "APAO");
      for (const e of apaos) {
        const count = result.assignments.filter((a) => a.employeeUuid === e.uuid).length;
        expect(count).toBeGreaterThan(0);
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
        birthDate: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const dbCtx = buildContextFromDbParts({
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
          return {
            id: `pre-${a.employeeUuid}-${a.date}`,
            scheduleMonthId: "m1",
            employeeId: a.employeeUuid,
            date: new Date(`${a.date}T12:00:00.000Z`),
            label: a.label,
            notes: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            employee: emp,
          };
        }),
      });

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

  it("só permite status GENERATED", async () => {
    const useCase = new ClearGeneratedScheduleUseCase({
      findMonthById: async () => ({
        id: "m1",
        year: 2026,
        month: 6,
        status: "DRAFT",
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

    await expect(useCase.execute("m1")).rejects.toBeInstanceOf(ScheduleNotGeneratedError);
  });

  it("limpa assignments GENERATOR e volta status DRAFT", async () => {
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
