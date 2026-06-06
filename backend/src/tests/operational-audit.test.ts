import { describe, expect, it } from "vitest";
import {
  computeEmployeeStatus,
  maxConsecutiveWorkDays,
} from "../domain/schedule/operational-audit.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import type { EmployeeOperationalSummary } from "../domain/schedule/operational-summary.js";

function baseStats(overrides: Partial<EmployeeOperationalSummary> = {}): EmployeeOperationalSummary {
  return {
    employeeUuid: "e1",
    name: "PAO Test",
    type: "PAO",
    turnos: 20,
    diasTrabalhados: 22,
    folgas: 10,
    folgaSocial: 2,
    folgaSocialOk: true,
    fa: 0,
    fani: 0,
    fp: 0,
    ferias: 0,
    disponivel: 8,
    availableForFlight: [],
    t6: 7,
    t7: 7,
    t8: 6,
    nd: 2,
    voos: 0,
    simuladores: 0,
    cursos: 0,
    cma: 0,
    outros: 0,
    folgasAjusteOperacional: false,
    maxConsec: 4,
    status: "OK",
    ...overrides,
  };
}

describe("Auditoria operacional", () => {
  it("1. MAX CONSEC calcula sequência correta", () => {
    expect(
      maxConsecutiveWorkDays(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-10"]),
    ).toBe(3);
    expect(maxConsecutiveWorkDays([])).toBe(0);
  });

  it("2. FANI aparece no resumo", () => {
    const input = realisticGenerationInput();
    const employees = input.employees.map((e, i) =>
      i === 0 ? { ...e, employee: { ...e.employee, birthDate: "1985-06-10" } } : e,
    );
    const ws = new GenerationWorkspace({ ...input, employees });
    ws.applyHardBlocks();
    const op = buildOperationalSummary(ws);
    const alpha = op.byEmployee.find((e) => e.name.includes("Alpha"));
    expect(alpha?.fani).toBe(1);
    expect(op.totals.totalFani).toBeGreaterThanOrEqual(1);
  });

  it("3. VOO DISP usa dias livres PAO", () => {
    const ws = new GenerationWorkspace(realisticGenerationInput());
    const op = buildOperationalSummary(ws);
    const pao = op.byEmployee.find((e) => e.type === "PAO");
    expect(pao?.disponivel).toBeGreaterThanOrEqual(0);
    expect(op.totals.totalDisponiveis).toBeGreaterThan(0);
  });

  it("4. STATUS OK quando PAO dentro das regras", () => {
    const status = computeEmployeeStatus(baseStats(), [], { daysInMonth: 30 });
    expect(status).toBe("OK");
  });

  it("5. STATUS ATENÇÃO para 11 folgas", () => {
    const status = computeEmployeeStatus(
      baseStats({ folgas: 11, folgasAjusteOperacional: true }),
      [],
      { daysInMonth: 30 },
    );
    expect(status).toBe("ATENÇÃO");
  });

  it("6. STATUS CRÍTICO para menos de 10 folgas PAO", () => {
    const status = computeEmployeeStatus(baseStats({ folgas: 9 }), [], { daysInMonth: 30 });
    expect(status).toBe("CRÍTICO");
  });

  it("7. cobertura T6/T7/T8 em percentual", () => {
    const ws = new GenerationWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.coverPaoShiftsPrioritized();
    const op = buildOperationalSummary(ws);
    expect(op.totals.coverageT6).toBeGreaterThanOrEqual(0);
    expect(op.totals.coverageT6).toBeLessThanOrEqual(100);
    expect(op.totals.coverageT7).toBeLessThanOrEqual(100);
    expect(op.totals.coverageT8).toBeLessThanOrEqual(100);
  });

  it("8. totalizadores batem com soma individual", () => {
    const op = buildOperationalSummary(new GenerationWorkspace(realisticGenerationInput()));
    const sumFolgas = op.byEmployee.reduce((n, e) => n + e.folgas, 0);
    const sumFani = op.byEmployee.reduce((n, e) => n + e.fani, 0);
    expect(op.totals.totalFolgas).toBe(sumFolgas);
    expect(op.totals.totalFani).toBe(sumFani);
  });
});
