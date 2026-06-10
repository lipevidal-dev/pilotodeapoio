import { describe, expect, it } from "vitest";
import { validateSchedule } from "../domain/rules/engine.js";
import { addDays } from "../domain/rules/dates.js";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { REGENERATION_CLEAR_LABELS } from "../domain/schedule/operational-labels.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function paoUuid(i = 0): string {
  return `real-${i + 1}`;
}

function assertNoIsolatedT8(ctx: ReturnType<typeof generationToScheduleContext>): void {
  for (const emp of ctx.employees.filter((e) => e.role === "PAO")) {
    const t8Days = ctx.assignments
      .filter((a) => a.employeeId === emp.id && a.shiftCode === "T8")
      .map((a) => a.workDate)
      .sort();
    for (const day of t8Days) {
      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const prevT8 = t8Days.includes(prev);
      const nextT8 = t8Days.includes(next);
      expect(prevT8 || nextT8, `T8 isolado em ${day} para ${emp.name}`).toBe(true);
    }
  }
}

describe("Motor estrutural — pré-alocações bloqueiam turnos", () => {
  const blocks = [
    { label: "SIMULADOR", key: "SIMULADOR" },
    { label: "VOO", key: "VOO" },
    { label: "FOLGA PEDIDA", key: "FP" },
    { label: "FÉRIAS", key: "FÉRIAS" },
    { label: "FOLGA SOCIAL", key: "FS" },
  ] as const;

  for (const b of blocks) {
    it(`${b.key} não recebe turno`, () => {
      const input = realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: paoUuid(0), date: "2026-06-10", label: b.label }],
      });
      const result = engine.generate(input);
      const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
      const shift = ctx.assignments.find(
        (a) => a.employeeId === 1 && a.workDate === "2026-06-10",
      );
      expect(shift).toBeUndefined();
    });
  }
});

describe("Motor estrutural — T8/T8/ND bloco indivisível", () => {
  it(
    "todo T8 tem par e ND subsequente",
    () => {
      const result = engine.generate(realisticGenerationInput());
      const ctx = generationToScheduleContext(
        realisticGenerationInput(),
        result.assignments,
        result.allocations,
      );
      assertNoIsolatedT8(ctx);
      expect(validateSchedule(ctx).some((v) => v.type === "T8 SEM ND")).toBe(false);
      expect(validateSchedule(ctx).some((v) => v.type === "ND FORA DE T8/T8")).toBe(false);
    },
    SLOW_MS,
  );

  it("pré-alocação no 3º dia impede bloco T8/T8/ND", () => {
    const input = realisticGenerationInput({
      lockedAllocations: [{ employeeUuid: paoUuid(0), date: "2026-06-12", label: "SIMULADOR" }],
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryPlaceT8Block(paoUuid(0), "2026-06-10")).toBe(false);
  });

  it("T8/T8 fim do mês gera ND no mês seguinte", () => {
    const input = realisticGenerationInput({ year: 2026, month: 6 });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const last = ws.days[ws.days.length - 2];
    if (ws.tryPlaceT8Block(paoUuid(0), last)) {
      const ndDay = addDays(addDays(last, 1), 1);
      expect(
        ws.allocations.some((a) => a.employeeUuid === paoUuid(0) && a.date === ndDay && a.label === "ND"),
      ).toBe(true);
    }
  });
});

describe("Motor estrutural — folgas PAO e FP", () => {
  it(
    "11 folgas não gera warning",
    () => {
      const input = realisticGenerationInput();
      const ws = new GenerationWorkspace(input);
      ws.applyHardBlocks();
      for (let i = 0; i < 11; i++) {
        const day = ws.days[i];
        if (ws.isPaoDayEmpty(paoUuid(0), day)) ws.lockDay(paoUuid(0), day, "FOLGA");
      }
      const ctx = ws.toScheduleContext();
      const folgaWarnings = validateSchedule(ctx).filter(
        (v) => v.type === "FOLGAS PAO" && v.level === "WARNING",
      );
      expect(folgaWarnings.length).toBe(0);
    },
    SLOW_MS,
  );

  it("3 FPs reais não geram warning de folgas pedidas", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [
        { employeeUuid: paoUuid(0), date: "2026-06-05" },
        { employeeUuid: paoUuid(0), date: "2026-06-12" },
        { employeeUuid: paoUuid(0), date: "2026-06-19" },
      ],
    });
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const fpWarnings = validateSchedule(ctx).filter((v) => v.type === "FOLGAS PEDIDAS");
    expect(fpWarnings.length).toBe(0);
  });
});

describe("Motor estrutural — APAO e voos", () => {
  it(
    "APAO pode ter dias vazios para folga comum manual",
    () => {
      const input = realisticGenerationInput({
        shifts: realisticGenerationInput().shifts.map((s) => ({
          ...s,
          active: s.code === "T2" || s.code === "T4" ? true : s.code.startsWith("T1") || s.code === "T3" ? false : s.active,
        })),
      });
      const result = engine.generate(input);
      const apaoUuids = input.employees.filter((e) => e.employee.role === "APAO").map((e) => e.uuid);
      let emptyDays = 0;
      for (const uuid of apaoUuids) {
        for (const day of input.employees.length ? new GenerationWorkspace(input).days : []) {
          const hasAssign = result.assignments.some((a) => a.employeeUuid === uuid && a.date === day);
          const hasAlloc = result.allocations.some((a) => a.employeeUuid === uuid && a.date === day);
          if (!hasAssign && !hasAlloc) emptyDays++;
        }
        const fa = result.allocations.filter(
          (a) => a.employeeUuid === uuid && a.label === "FOLGA AGRUPADA",
        ).length;
        expect(fa).toBe(0);
      }
      expect(emptyDays).toBeGreaterThan(0);
    },
    SLOW_MS,
  );

  it("applyFlightsToAvailablePaoDays não sobrescreve turnos", () => {
    const input = realisticGenerationInput();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.seedAssignments([{ employeeUuid: paoUuid(0), date: "2026-06-10", shiftCode: "T6" }]);
    const created = ws.applyFlightsToAvailablePaoDays();
    expect(created.some((c) => c.employeeUuid === paoUuid(0) && c.date === "2026-06-10")).toBe(
      false,
    );
    expect(created.length).toBeGreaterThan(0);
  });
});

describe("Motor estrutural — regeneração", () => {
  it("VOO está em REGENERATION_CLEAR_LABELS", () => {
    expect(REGENERATION_CLEAR_LABELS).toContain("VOO");
  });
});

describe("Motor estrutural — conflito folga + turno", () => {
  it("repair não cria turno sobre FOLGA SOCIAL", () => {
    const input = realisticGenerationInput({
      lockedAllocations: [{ employeeUuid: paoUuid(0), date: "2026-06-15", label: "FOLGA SOCIAL" }],
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-15", "T7")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-15", "T7", true)).toBe(false);
  });
});

describe("Motor estrutural — férias parciais", () => {
  it("primeira quinzena volta ao trabalho após dia 15", () => {
    const vacDays = Array.from({ length: 15 }, (_, i) => ({
      employeeUuid: paoUuid(0),
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    }));
    const input = realisticGenerationInput({ vacationDays: vacDays });
    const result = engine.generate(input);
    const feriasAfter15 = result.allocations.filter(
      (a) =>
        a.employeeUuid === paoUuid(0) &&
        a.date >= "2026-06-16" &&
        a.label.toUpperCase().includes("FÉRIAS"),
    );
    expect(feriasAfter15.length).toBe(0);
    const secondHalf = Array.from({ length: 15 }, (_, i) =>
      `2026-06-${String(16 + i).padStart(2, "0")}`,
    );
    const activeSecondHalf = secondHalf.filter(
      (day) =>
        result.assignments.some((a) => a.employeeUuid === paoUuid(0) && a.date === day) ||
        result.allocations.some(
          (a) =>
            a.employeeUuid === paoUuid(0) &&
            a.date === day &&
            !["FÉRIAS", "FERIAS"].includes(a.label.toUpperCase()),
        ),
    );
    expect(activeSecondHalf.length).toBeGreaterThan(10);
  });
});
