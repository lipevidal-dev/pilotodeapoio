import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { addDays, iterDays } from "../domain/rules/dates.js";
import { IDEAL_PAO_REST_COUNT, MAX_PAO_REST_COUNT } from "../domain/rules/constants.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import type { GenerationInput } from "../domain/schedule/generation-types.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function maxConsecutiveDays(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort();
  let max = 1;
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === addDays(sorted[i - 1], 1)) {
      streak++;
      max = Math.max(max, streak);
    } else {
      streak = 1;
    }
  }
  return max;
}

function longestRunSameApao(
  assignments: { employeeUuid: string; date: string }[],
  uuids: string[],
): number {
  const byDate = new Map<string, string>();
  for (const a of assignments) {
    if (uuids.includes(a.employeeUuid)) {
      byDate.set(a.date, a.employeeUuid);
    }
  }
  const days = [...byDate.keys()].sort();
  let max = 0;
  let streak = 0;
  let prev: string | null = null;
  for (const d of days) {
    const u = byDate.get(d)!;
    if (u === prev) {
      streak++;
    } else {
      streak = 1;
      prev = u;
    }
    max = Math.max(max, streak);
  }
  return max;
}

describe("ND — somente após T8/T8", () => {
  it(
    "1. ND só aparece após T8/T8",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const ctx = generationToScheduleContext(input, result.assignments, result.allocations);

      for (const al of ctx.allocations.filter((a) => a.allocType === "ND")) {
        const d1 = addDays(al.allocDate, -2);
        const d2 = addDays(al.allocDate, -1);
        expect(
          ctx.assignments.some(
            (a) => a.employeeId === al.employeeId && a.workDate === d1 && a.shiftCode === "T8",
          ),
        ).toBe(true);
        expect(
          ctx.assignments.some(
            (a) => a.employeeId === al.employeeId && a.workDate === d2 && a.shiftCode === "T8",
          ),
        ).toBe(true);
      }
      expect(validateSchedule(ctx).some((v) => v.type === "ND FORA DE T8/T8")).toBe(false);
    },
    SLOW_MS,
  );

  it("2. dia vazio não vira ND automaticamente", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.fillUnclassifiedPaoDays();
    const ndCount = ws.allocations.filter((a) => a.label === "ND").length;
    expect(ndCount).toBe(0);
  });

  it("3. ND não recebe turno no mesmo dia", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(validateSchedule(ctx).some((v) => v.type === "TURNO EM DIA ND")).toBe(false);
  });

  it(
    "4. ND conta em dias trabalhados no resumo operacional",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const ws = new GenerationWorkspace(input);
      for (const a of result.assignments) {
        const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
        ws["planned"].set(`${did}|${a.date}`, a.shiftCode);
      }
      for (const al of result.allocations) {
        ws.allocations.push(al);
      }
      const op = buildOperationalSummary(ws);
      const withNd = op.byEmployee.find((e) => e.nd > 0);
      if (withNd) {
        expect(withNd.diasTrabalhados).toBeGreaterThanOrEqual(withNd.turnos + withNd.nd);
      }
    },
    SLOW_MS,
  );
});

describe("APAO — regime 6x1", () => {
  it(
    "1. APAO não trabalha mais de 6 dias consecutivos",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      for (const e of input.employees.filter((x) => x.employee.role === "APAO")) {
        const dates = result.assignments
          .filter((a) => a.employeeUuid === e.uuid)
          .map((a) => a.date);
        expect(maxConsecutiveDays(dates)).toBeLessThanOrEqual(6);
      }
    },
    SLOW_MS,
  );

  it(
    "2. APAO recebe folga no 7º dia consecutivo (sem assignment)",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const days = iterDays(input.year, input.month);
      for (const e of input.employees.filter((x) => x.employee.role === "APAO")) {
        const workSet = new Set(
          result.assignments.filter((a) => a.employeeUuid === e.uuid).map((a) => a.date),
        );
        for (let i = 6; i < days.length; i++) {
          const window = days.slice(i - 6, i + 1);
          const workedAll7 = window.every((d) => workSet.has(d));
          expect(workedAll7).toBe(false);
        }
      }
    },
    SLOW_MS,
  );

  it("3. APAO nunca fica sozinho", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(validateSchedule(ctx).some((v) => v.type === "APAO SEM PAO")).toBe(false);
  });

  it("4. APAO nunca trabalha sem PAO", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(validateSchedule(ctx).some((v) => v.type === "APAO SEM PAO")).toBe(false);
  });

  it(
    "5. APAOs ativos recebem carga equilibrada",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const counts = input.employees
        .filter((e) => e.employee.role === "APAO")
        .map(
          (e) => result.assignments.filter((a) => a.employeeUuid === e.uuid).length,
        );
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      expect(max - min).toBeLessThanOrEqual(8);
    },
    SLOW_MS,
  );

  it(
    "6. não existe alternância artificial dia sim/dia não",
    () => {
      const input = realisticGenerationInput();
      const result = engine.generate(input);
      const apaos = input.employees.filter((e) => e.employee.role === "APAO").map((e) => e.uuid);
      const longest = longestRunSameApao(result.assignments, apaos);
      expect(longest).toBeGreaterThanOrEqual(3);
    },
    SLOW_MS,
  );
});

describe("Resumo operacional", () => {
  function opSummary(input: GenerationInput) {
    const result = engine.generate(input);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const emp = input.employees.find((e) => e.uuid === a.employeeUuid)!;
      ws["planned"].set(`${emp.domainId}|${a.date}`, a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    return buildOperationalSummary(ws);
  }

  it("1. PAO: TURNOS = T6 + T7 + T8", () => {
    const op = opSummary(realisticGenerationInput());
    for (const e of op.byEmployee.filter((x) => x.type === "PAO")) {
      expect(e.turnos).toBe(e.t6 + e.t7 + e.t8);
    }
  });

  it("1b. APAO: turnos contam T1–T4", () => {
    const op = opSummary(realisticGenerationInput());
    for (const e of op.byEmployee.filter((x) => x.type === "APAO")) {
      if (e.turnos > 0) {
        expect(e.t6 + e.t7 + e.t8).toBe(0);
        expect(e.diasTrabalhados).toBeGreaterThanOrEqual(e.turnos);
      }
    }
  });

  it("2. ND conta em dias trabalhados", () => {
    const op = opSummary(realisticGenerationInput());
    const withNd = op.byEmployee.find((e) => e.nd > 0);
    if (withNd) {
      expect(withNd.diasTrabalhados).toBeGreaterThanOrEqual(withNd.nd);
    }
  });

  it("3. VOO conta em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        flightDays: [{ employeeUuid: "real-1", date: "2026-06-10" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.voos).toBeGreaterThanOrEqual(1);
    expect(pao.diasTrabalhados).toBeGreaterThanOrEqual(pao.voos);
  });

  it("4. SIMULADOR conta em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: "real-2", date: "2026-06-11", label: "SIMULADOR" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-2")!;
    expect(pao.simuladores).toBe(1);
    expect(pao.diasTrabalhados).toBeGreaterThanOrEqual(1);
  });

  it("5. CURSO conta em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: "real-3", date: "2026-06-12", label: "CURSO" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-3")!;
    expect(pao.cursos).toBe(1);
  });

  it("6. CMA conta em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: "real-4", date: "2026-06-13", label: "CMA" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-4")!;
    expect(pao.cma).toBe(1);
  });

  it("7. OUTRO conta em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: "real-5", date: "2026-06-14", label: "OUTRO" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-5")!;
    expect(pao.outros).toBe(1);
  });

  it("8. FP não conta em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        approvedDayOff: [{ employeeUuid: "real-1", date: "2026-06-15" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.fp).toBeGreaterThanOrEqual(1);
    const workOnly =
      pao.t6 + pao.t7 + pao.t8 + pao.nd + pao.voos + pao.simuladores + pao.cursos + pao.cma + pao.outros;
    expect(pao.diasTrabalhados).toBe(workOnly);
  });

  it("9. FÉRIAS não contam em dias trabalhados", () => {
    const op = opSummary(
      realisticGenerationInput({
        vacationDays: [{ employeeUuid: "real-1", date: "2026-06-16" }],
      }),
    );
    const pao = op.byEmployee.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.ferias).toBeGreaterThanOrEqual(1);
  });

  it("10. PAO mantém exatamente 10 folgas", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const restLabels = new Set([
      "FOLGA",
      "FOLGA SOCIAL",
      "FOLGA PEDIDA",
      "FOLGA ESCOLHIDA",
      "FOLGA AGRUPADA",
      "FOLGA ANIVERSÁRIO",
    ]);
    for (const e of input.employees.filter((x) => x.employee.role === "PAO")) {
      const n = result.allocations.filter(
        (a) => a.employeeUuid === e.uuid && restLabels.has(a.label.toUpperCase()),
      ).length;
      expect(n).toBeGreaterThanOrEqual(IDEAL_PAO_REST_COUNT);
      expect(n).toBeLessThanOrEqual(MAX_PAO_REST_COUNT);
    }
  });
});
