import { describe, expect, it } from "vitest";
import { birthdayInMonth, FANI_LABEL } from "../domain/rules/birthday.js";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const engine = new ScheduleGenerationEngine();

function paoUuid(i = 0): string {
  return `real-${i + 1}`;
}

function withBirthday(
  uuid: string,
  birthDate: string,
  overrides: Parameters<typeof realisticGenerationInput>[0] = {},
) {
  const input = realisticGenerationInput(overrides);
  const employees = input.employees.map((e) =>
    e.uuid === uuid ? { ...e, employee: { ...e.employee, birthDate } } : e,
  );
  return { ...input, employees };
}

describe("FANI — folga de aniversário", () => {
  it("1. birthdayInMonth resolve data no mês", () => {
    expect(birthdayInMonth("1990-06-15", 2026, 6)).toBe("2026-06-15");
    expect(birthdayInMonth("1990-07-01", 2026, 6)).toBeNull();
  });

  it("2. birthdayInMonth ajusta 29/02 em ano não bissexto", () => {
    expect(birthdayInMonth("1992-02-29", 2026, 2)).toBe("2026-02-28");
  });

  it("3. aniversário gera FANI e impede turno", () => {
    const result = engine.generate(withBirthday(paoUuid(0), "1985-06-10"));
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-10" && a.label === FANI_LABEL,
      ),
    ).toBe(true);
    expect(
      result.assignments.some((a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-10"),
    ).toBe(false);
  });

  it("4. FANI não é folga pedida", () => {
    const result = engine.generate(withBirthday(paoUuid(1), "1985-06-12"));
    const fani = result.allocations.filter(
      (a) => a.employeeUuid === paoUuid(1) && a.label === FANI_LABEL,
    );
    expect(fani.length).toBe(1);
    expect(result.allocations.some((a) => a.label === "FOLGA PEDIDA" && a.date === "2026-06-12")).toBe(
      false,
    );
  });

  it("5. férias no aniversário preservam férias e registram aviso", () => {
    const result = engine.generate(
      withBirthday(paoUuid(2), "1985-06-10", {
        vacationDays: [{ employeeUuid: paoUuid(2), date: "2026-06-10" }],
      }),
    );
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(2) && a.date === "2026-06-10" && a.label === "FÉRIAS",
      ),
    ).toBe(true);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(2) && a.date === "2026-06-10" && a.label === FANI_LABEL,
      ),
    ).toBe(false);
    expect(result.violations.some((v) => v.type === "FANI CONFLITO")).toBe(true);
  });

  it("6. VOO no aniversário preserva VOO e registram aviso", () => {
    const result = engine.generate(
      withBirthday(paoUuid(3), "1985-06-08", {
        flightDays: [{ employeeUuid: paoUuid(3), date: "2026-06-08" }],
      }),
    );
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === paoUuid(3) && a.date === "2026-06-08" && a.label === "VOO",
      ),
    ).toBe(true);
    expect(result.violations.some((v) => v.type === "FANI CONFLITO")).toBe(true);
  });

  it("7. FANI no último dia do mês gera folga no 1º dia do mês seguinte", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [],
        allocations: [{ employeeUuid: paoUuid(0), date: "2026-06-30", label: FANI_LABEL }],
      },
    });
    const employees = input.employees.map((e) =>
      e.uuid === paoUuid(0) ? { ...e, employee: { ...e.employee, birthDate: "1985-06-30" } } : e,
    );
    const ws = new GenerationWorkspace({ ...input, employees });
    ws.applyHardBlocks();
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-07-01" && a.label === "FOLGA",
      ),
    ).toBe(true);
  });
});
