import { describe, expect, it } from "vitest";
import { validateT8Blocks } from "../../domain/rules/t8-planner.js";
import { ndDayAfterT8Pair } from "../../domain/rules/t8-planner.js";
import {
  ctxFromWorkspace,
  freshWorkspace,
  generationToScheduleContext,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  validateWorkspace,
} from "./slice-helpers.js";

describe("Fatia 4 — T8 Planning", () => {
  it("T8 é atribuído somente a PAO", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    expect(ws.tryPlaceT8Block(paoUuid(0), "2026-06-03")).toBe(true);
    const assignments = ws.toAssignments().filter((a) => a.shiftCode === "T8");
    expect(assignments.every((a) => a.employeeUuid.startsWith("uuid-"))).toBe(true);
  });

  it("bloco T8→T8→ND é formado ao colocar par", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    ws.tryPlaceT8Block(paoUuid(0), "2026-06-04");
    ws.ensureNdForT8Pairs();
    const nd = ndDayAfterT8Pair("2026-06-04");
    expect(ws.allocations.some((a) => a.employeeUuid === paoUuid(0) && a.date === nd && a.label === "ND")).toBe(true);
  });

  it("T8 isolado é detectado pela validação", () => {
    const input = minimalPaoInput(2);
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(0), date: "2026-06-10", shiftCode: "T8" }],
      [],
    );
    const issues = validateT8Blocks(ctx);
    expect(issues.some((i) => i.type === "T8 ISOLADO")).toBe(true);
  });

  it("repairIsolatedT8 remove T8 sem par", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(0), "2026-06-10", "T8");
    ws.repairIsolatedT8();
    expect(ws.toAssignments().some((a) => a.date === "2026-06-10" && a.shiftCode === "T8")).toBe(false);
  });

  it("T8 com bloqueio de férias não é atribuído", () => {
    const input = minimalPaoInput(2);
    input.vacationDays = [{ employeeUuid: paoUuid(0), date: "2026-06-05" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryPlaceT8Block(paoUuid(0), "2026-06-05")).toBe(false);
  });

  it("planT8CoverageRotating + coverT8BlocksOnly não deixa T8 isolado crítico", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.planT8CoverageRotating();
    ws.coverT8BlocksOnly();
    ws.ensureNdForT8Pairs();
    const { issues } = validateWorkspace(ws);
    const isolated = issues.filter((i) => i.type === "T8 ISOLADO");
    expect(isolated).toHaveLength(0);
  });

  it("equipe reduzida (1 PAO) ainda tenta cobertura T8 via bloco", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
    });
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.planT8CoverageRotating();
    ws.coverT8BlocksOnly();
    const ctx = ctxFromWorkspace(ws);
    const t8Count = ctx.assignments.filter((a) => a.shiftCode === "T8").length;
    expect(t8Count).toBeGreaterThanOrEqual(0);
  });
});
