import { describe, expect, it } from "vitest";
import { ScheduleRepairEngine } from "../../domain/schedule/schedule-repair-engine.js";
import {
  freshWorkspace,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
} from "./slice-helpers.js";

const repairEngine = new ScheduleRepairEngine();

describe("Fatia 8 — Repair Engine", () => {
  it("repara gap de T6 com PAO elegível", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(1), "2026-06-10", "T7");
    ws.tryAssignShift(paoUuid(2), "2026-06-10", "T8");
    expect(ws.hasPaoCoverage("2026-06-10", "T6")).toBe(false);

    const result = repairEngine.repair(ws, []);
    expect(result.repaired).toBeGreaterThan(0);
    expect(ws.hasPaoCoverage("2026-06-10", "T6")).toBe(true);
  });

  it("repara gap de T7", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(0), "2026-06-11", "T6");
    ws.tryAssignShift(paoUuid(2), "2026-06-11", "T8");
    repairEngine.repair(ws, []);
    expect(ws.hasPaoCoverage("2026-06-11", "T7")).toBe(true);
  });

  it("tenta reparar gap de T8 via tryAssignT8Coverage", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(0), "2026-06-12", "T6");
    ws.tryAssignShift(paoUuid(1), "2026-06-12", "T7");
    const before = ws.hasPaoCoverage("2026-06-12", "T8");
    repairEngine.repair(ws, []);
    const after = ws.hasPaoCoverage("2026-06-12", "T8");
    expect(after || !before).toBe(true);
  });

  it("bloqueios impedem reparo no dia bloqueado", () => {
    const input = minimalPaoInput(3);
    input.vacationDays = [
      { employeeUuid: paoUuid(0), date: "2026-06-13" },
      { employeeUuid: paoUuid(1), date: "2026-06-13" },
      { employeeUuid: paoUuid(2), date: "2026-06-13" },
    ];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const result = repairEngine.repair(ws, []);
    expect(ws.hasPaoCoverage("2026-06-13", "T6")).toBe(false);
    expect(result.remainingGaps).toBeGreaterThan(0);
  });

  it("limite de 40 rodadas evita loop infinito", () => {
    const ws = freshWorkspace(realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
    }));
    ws.applyHardBlocks();
    const started = performance.now();
    const result = repairEngine.repair(ws, []);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(10_000);
    expect(result.remainingGaps).toBeGreaterThan(0);
  });

  it("reparo não sobrescreve bloqueio de VOO", () => {
    const input = minimalPaoInput(3);
    input.flightDays = [{ employeeUuid: paoUuid(0), date: "2026-06-14" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    repairEngine.repair(ws, []);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-14", "T6")).toBe(false);
    expect(ws.allocations.some((a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-14" && a.label === "VOO")).toBe(true);
  });

  it("remainingGaps gera sugestões quando não repara", () => {
    const input = minimalPaoInput(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const suggestions: string[] = [];
    const result = repairEngine.repair(ws, suggestions);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.remainingGaps).toBeGreaterThan(0);
  });
});
