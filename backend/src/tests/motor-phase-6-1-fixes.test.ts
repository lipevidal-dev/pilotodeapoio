import { describe, expect, it } from "vitest";
import { validateSchedule } from "../domain/rules/engine.js";
import { addDays } from "../domain/rules/dates.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { REGENERATION_CLEAR_LABELS } from "../domain/schedule/operational-labels.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { baseGenerationInput, minimalPaoInput } from "./generation-fixtures.js";
import type { GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { GenerationInput } from "../domain/schedule/generation-types.js";

function paoUuid(i = 0): string {
  return `uuid-${i + 1}`;
}

function inputWithRestrictions(
  restrictions: Array<{ employeeUuid: string; shiftCode: string }>,
  paoCount = 3,
): GenerationInput {
  const input = minimalPaoInput(paoCount);
  input.shiftRestrictions = buildShiftRestrictionMap(input.employees, restrictions);
  return input;
}

describe("Fase 6.1 — restrições de turno", () => {
  it("funcionário sem restrições aceita T6", () => {
    const input = minimalPaoInput(2);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T6")).toBe(true);
  });

  it("funcionário restrito ao T6 não recebe T6", () => {
    const input = inputWithRestrictions([{ employeeUuid: paoUuid(0), shiftCode: "T6" }]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T6")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T7")).toBe(true);
  });

  it("funcionário restrito ao T7 não recebe T7", () => {
    const input = inputWithRestrictions([{ employeeUuid: paoUuid(0), shiftCode: "T7" }]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-11", "T7")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-11", "T6")).toBe(true);
  });

  it("funcionário restrito ao T8 não recebe T8", () => {
    const input = inputWithRestrictions([{ employeeUuid: paoUuid(0), shiftCode: "T8" }]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-12", "T8")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-12", "T7")).toBe(true);
  });

  it("múltiplas restrições bloqueiam T6 e T8", () => {
    const input = inputWithRestrictions([
      { employeeUuid: paoUuid(0), shiftCode: "T6" },
      { employeeUuid: paoUuid(0), shiftCode: "T8" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-13", "T6")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-13", "T8")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-13", "T7")).toBe(true);
  });

  it("buildShiftRestrictionMap converte UUID para domainId", () => {
    const employees: GenerationInputEmployee[] = [
      { uuid: "emp-a", domainId: 1, employee: { id: 1, name: "PAO A", role: "PAO", seniority: 1 } },
    ];
    const map = buildShiftRestrictionMap(employees, [{ employeeUuid: "emp-a", shiftCode: "t6" }]);
    expect(map?.get(1)?.has("T6")).toBe(true);
  });
});

describe("Fase 6.1 — validação cross-month", () => {
  it("Rest12hRule detecta descanso insuficiente no 1º dia do mês", () => {
    const input = baseGenerationInput({
      crossMonthHistory: {
        assignments: [{ employeeUuid: paoUuid(0), date: "2026-05-31", shiftCode: "T8" }],
        allocations: [],
      },
    });
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(0), date: "2026-06-01", shiftCode: "T6" }],
      [],
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "DESCANSO MENOR QUE 12H");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].date).toBe("2026-06-01");
  });

  it("ConsecutiveDaysRule considera histórico no 1º dia do mês", () => {
    const histDays = Array.from({ length: 6 }, (_, i) => addDays("2026-06-01", -(6 - i)));
    const input = baseGenerationInput({
      crossMonthHistory: {
        assignments: histDays.map((date) => ({
          employeeUuid: paoUuid(0),
          date,
          shiftCode: "T6",
        })),
        allocations: [],
      },
    });
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(0), date: "2026-06-01", shiftCode: "T6" }],
      [],
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "MAIS DE 6 DIAS");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].date).toBe("2026-06-01");
  });

  it("descanso adequado após T8 no último dia do mês anterior passa", () => {
    const input = baseGenerationInput({
      crossMonthHistory: {
        assignments: [{ employeeUuid: paoUuid(0), date: "2026-05-30", shiftCode: "T8" }],
        allocations: [],
      },
    });
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(0), date: "2026-06-01", shiftCode: "T6" }],
      [],
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "DESCANSO MENOR QUE 12H");
    expect(issues.length).toBe(0);
  });
});

describe("Fase 6.1 — regeneração FOLGA AGRUPADA", () => {
  it("FOLGA AGRUPADA está em REGENERATION_CLEAR_LABELS", () => {
    expect(REGENERATION_CLEAR_LABELS).toContain("FOLGA AGRUPADA");
  });

  it("escala com FA: label é elegível para limpeza na regeneração", () => {
    const input = baseGenerationInput();
    const ctx = generationToScheduleContext(
      input,
      [],
      [{ employeeUuid: paoUuid(1), date: "2026-06-05", label: "FOLGA AGRUPADA" }],
    );
    expect(ctx.allocations.some((a) => a.allocType === "FOLGA AGRUPADA")).toBe(true);
    expect(REGENERATION_CLEAR_LABELS).toContain("FOLGA AGRUPADA");
  });
});
