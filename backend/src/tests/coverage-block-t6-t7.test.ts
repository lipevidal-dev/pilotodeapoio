import { describe, expect, it } from "vitest";
import { analyzeT6T7BlockCoverage } from "../domain/schedule/coverage-block-metrics.js";
import {
  coverT6T7ByBlocks,
  coverT6T7ByUnitDays,
  longestConsecutiveRun,
} from "../domain/schedule/t6-t7-block-coverage.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import {
  freshWorkspace,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
} from "./schedule-slices/slice-helpers.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function coverT6Only(ws: ReturnType<typeof freshWorkspace>): void {
  coverT6T7ByBlocks(ws, ["T6"]);
}

describe("Fase 7.1 — Cobertura T6/T7 por blocos consecutivos", () => {
  it("funcionário elegível mantém bloco T6", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(0), "2026-06-01", "T6");
    ws.tryAssignShift(paoUuid(0), "2026-06-02", "T6");
    coverT6Only(ws);
    expect(ws.findPaoOnShift("2026-06-03", "T6")).toBe(paoUuid(0));
    const run = longestConsecutiveRun(ws.toAssignments(), paoUuid(0), "T6", ws.days);
    expect(run).toBeGreaterThanOrEqual(3);
  });

  it("funcionário elegível mantém bloco T7", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(1), "2026-06-05", "T7");
    ws.tryAssignShift(paoUuid(1), "2026-06-06", "T7");
    coverT6T7ByBlocks(ws, ["T7"]);
    expect(ws.findPaoOnShift("2026-06-07", "T7")).toBe(paoUuid(1));
    const run = longestConsecutiveRun(ws.toAssignments(), paoUuid(1), "T7", ws.days);
    expect(run).toBeGreaterThanOrEqual(3);
  });

  it("bloco T6 interrompido por férias", () => {
    const input = minimalPaoInput(4);
    input.vacationDays = [{ employeeUuid: paoUuid(0), date: "2026-06-05" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    const blockedDay = ws.toAssignments().find(
      (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-05" && a.shiftCode === "T6",
    );
    expect(blockedDay).toBeUndefined();
    expect(ws.hasPaoCoverage("2026-06-05", "T6")).toBe(true);
  });

  it("bloco T6 interrompido por FP", () => {
    const input = minimalPaoInput(4);
    input.approvedDayOff = [{ employeeUuid: paoUuid(0), date: "2026-06-04" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    expect(
      ws.toAssignments().some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-04" && a.shiftCode === "T6",
      ),
    ).toBe(false);
  });

  it("bloco T6 interrompido por curso", () => {
    const input = minimalPaoInput(4);
    input.lockedAllocations = [{ employeeUuid: paoUuid(0), date: "2026-06-03", label: "CURSO" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    expect(
      ws.toAssignments().some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-03" && a.shiftCode === "T6",
      ),
    ).toBe(false);
  });

  it("bloco T6 interrompido por simulador", () => {
    const input = minimalPaoInput(4);
    input.lockedAllocations = [{ employeeUuid: paoUuid(0), date: "2026-06-03", label: "SIMULADOR" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    expect(
      ws.toAssignments().some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-03" && a.shiftCode === "T6",
      ),
    ).toBe(false);
  });

  it("bloco T6 interrompido por CMA", () => {
    const input = minimalPaoInput(4);
    input.lockedAllocations = [{ employeeUuid: paoUuid(0), date: "2026-06-03", label: "CMA" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    expect(
      ws.toAssignments().some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-03" && a.shiftCode === "T6",
      ),
    ).toBe(false);
  });

  it("bloco T6 interrompido por restrição de turno", () => {
    const input = minimalPaoInput(4);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T6" },
    ]);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    expect(ws.toAssignments().every((a) => !(a.employeeUuid === paoUuid(0) && a.shiftCode === "T6"))).toBe(
      true,
    );
    expect(ws.hasPaoCoverage("2026-06-01", "T6")).toBe(true);
  });

  it("cobertura unitária apenas quando necessário (1 PAO)", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
    });
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6Only(ws);
    const gaps = ws.listCoverageGaps().filter((g) => g.shiftCode === "T6");
    const metrics = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
    // Com 1 PAO não há blocos longos no mês inteiro — furos ou blocos curtos (≤2 dias)
    expect(gaps.length > 0 || metrics.T6.blockSizes.some((s) => s <= 2)).toBe(true);
  });

  it("média de bloco maior que a estratégia unitária", () => {
    const input = minimalPaoInput(6);
    const wsLegacy = freshWorkspace(input);
    wsLegacy.applyHardBlocks();
    coverT6T7ByUnitDays(wsLegacy);
    const legacyMetrics = analyzeT6T7BlockCoverage(wsLegacy.toAssignments(), wsLegacy.days);

    const wsBlocks = freshWorkspace(input);
    wsBlocks.applyHardBlocks();
    coverT6T7ByBlocks(wsBlocks);
    const blockMetrics = analyzeT6T7BlockCoverage(wsBlocks.toAssignments(), wsBlocks.days);

    const legacyAvg = (legacyMetrics.T6.averageBlockSize + legacyMetrics.T7.averageBlockSize) / 2;
    const blockAvg = (blockMetrics.T6.averageBlockSize + blockMetrics.T7.averageBlockSize) / 2;
    expect(blockAvg).toBeGreaterThanOrEqual(legacyAvg);
    expect(blockMetrics.unitCoverageTotal).toBeLessThanOrEqual(legacyMetrics.unitCoverageTotal + 2);
  });

  it("métricas identificam blocos consecutivos na grade", () => {
    const assignments = [
      { employeeUuid: "a", date: "2026-06-01", shiftCode: "T6" },
      { employeeUuid: "a", date: "2026-06-02", shiftCode: "T6" },
      { employeeUuid: "a", date: "2026-06-03", shiftCode: "T6" },
      { employeeUuid: "b", date: "2026-06-04", shiftCode: "T6" },
    ];
    const metrics = analyzeT6T7BlockCoverage(assignments, MONTH_DAYS);
    expect(metrics.T6.blockCount).toBe(2);
    expect(metrics.T6.averageBlockSize).toBe(2);
    expect(metrics.T6.unitCoverageCount).toBe(1);
  });

  it("nenhum PAO excede 5 dias consecutivos no mesmo turno", () => {
    const ws = freshWorkspace(minimalPaoInput(6));
    ws.applyHardBlocks();
    coverT6T7ByBlocks(ws);
    for (const code of ["T6", "T7"] as const) {
      for (let i = 0; i < 6; i++) {
        const run = longestConsecutiveRun(ws.toAssignments(), paoUuid(i), code, ws.days);
        expect(run).toBeLessThanOrEqual(5);
      }
    }
  });

  it("motor completo não gera sequências longas (>5) na cobertura por blocos", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    coverT6T7ByBlocks(ws);
    for (const emp of ws.paoEmps) {
      for (const code of ["T6", "T7"] as const) {
        const run = longestConsecutiveRun(ws.toAssignments(), emp.uuid, code, ws.days);
        expect(run).toBeLessThanOrEqual(5);
      }
    }
  });

  it("não alterna PAO diariamente quando continuidade é possível", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    coverT6Only(ws);
    let alternations = 0;
    let prev: string | undefined;
    for (const day of ws.days) {
      const uuid = ws.findPaoOnShift(day, "T6");
      if (!uuid) continue;
      if (prev && prev !== uuid) alternations++;
      prev = uuid;
    }
    const metrics = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
    expect(metrics.T6.averageBlockSize).toBeGreaterThan(1);
    expect(alternations).toBeLessThan(ws.days.length / 2);
  });
});
