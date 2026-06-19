import { describe, expect, it } from "vitest";
import { listPaoCoverageGaps } from "../../domain/rules/coverage.js";
import { runFinalCoverageGate } from "../../domain/rules/coverage-gate.js";
import { ScheduleGenerationEngine } from "../../domain/schedule/schedule-generation-engine.js";
import {
  freshWorkspace,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  SLOW_SLICE_MS,
} from "./slice-helpers.js";
import { emptyContext } from "../fixtures.js";

const engine = new ScheduleGenerationEngine();

describe("Fatia 5 — Coverage Planning", () => {
  it("coverT6T7Only preenche T6 e T7 por dia", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    const gaps = ws.listCoverageGaps().filter((g) => g.shiftCode === "T6" || g.shiftCode === "T7");
    expect(gaps.length).toBe(0);
  });

  it("coverT8BlocksOnly reduz gaps de T8", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    ws.planT8CoverageRotating();
    ws.coverT8BlocksOnly();
    const t8Gaps = ws.listCoverageGaps().filter((g) => g.shiftCode === "T8");
    expect(t8Gaps.length).toBeLessThan(30);
  });

  it("máximo 2 PAOs no mesmo turno/dia após cobertura", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    const assignments = ws.toAssignments();
    for (const day of ws.days) {
      for (const code of ["T6", "T7"] as const) {
        const count = assignments.filter((a) => a.date === day && a.shiftCode === code).length;
        expect(count).toBeLessThanOrEqual(2);
      }
    }
  });

  it("listPaoCoverageGaps detecta T6 ausente", () => {
    const ctx = emptyContext();
    ctx.assignments.push(
      { employeeId: 2, employeeName: "PAO B", workDate: "2026-06-01", shiftCode: "T7" },
      { employeeId: 3, employeeName: "PAO C", workDate: "2026-06-01", shiftCode: "T8" },
    );
    const gaps = listPaoCoverageGaps(ctx);
    expect(gaps.some((g) => g.shiftCode === "T6" && g.date === "2026-06-01")).toBe(true);
  });

  it("cenário crítico (1 PAO) produz gaps de cobertura", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
    });
    const result = engine.generate(input);
    expect(result.summary.coverageGaps).toBeGreaterThan(0);
  }, SLOW_SLICE_MS);

  it("cenário normal (6 PAO) tende a zerar gaps após motor completo", () => {
    const result = engine.generate(realisticGenerationInput());
    expect(result.summary.coverageGaps).toBe(0);
  }, SLOW_SLICE_MS);

  it("bloqueio massivo reduz cobertura possível", () => {
    const input = realisticGenerationInput();
    const uuid = input.employees[0].uuid;
    input.vacationDays = Array.from({ length: 20 }, (_, i) => ({
      employeeUuid: uuid,
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    const gate = runFinalCoverageGate(ws.toScheduleContext());
    expect(gate.issues.length).toBeGreaterThan(0);
  });

  it("hasPaoCoverage reflete atribuição no workspace", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(0), "2026-06-10", "T6");
    expect(ws.hasPaoCoverage("2026-06-10", "T6")).toBe(true);
    expect(ws.hasPaoCoverage("2026-06-10", "T7")).toBe(false);
  });
});
