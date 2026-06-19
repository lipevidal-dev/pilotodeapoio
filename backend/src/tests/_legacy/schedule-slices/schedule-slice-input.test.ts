import { describe, expect, it } from "vitest";
import { buildShiftRestrictionMap } from "../../infrastructure/mappers/generation-input.mapper.js";
import { crossHistoryToPreviousMonthAssignments } from "../../domain/schedule/generation-context.js";
import {
  baseGenerationInput,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  SLICE_MONTH,
  SLICE_YEAR,
} from "./slice-helpers.js";
import type { GenerationInputEmployee } from "../../domain/schedule/generation-types.js";

describe("Fatia 1 — GenerationInput", () => {
  it("input completo contém employees, shifts e coleções operacionais", () => {
    const input = realisticGenerationInput({
      vacationDays: [{ employeeUuid: "real-1", date: "2026-06-05" }],
      approvedDayOff: [{ employeeUuid: "real-2", date: "2026-06-06" }],
      flightDays: [{ employeeUuid: "real-3", date: "2026-06-07" }],
      lockedAllocations: [{ employeeUuid: "real-4", date: "2026-06-08", label: "SIMULADOR" }],
      crossMonthHistory: {
        assignments: [{ employeeUuid: "real-1", date: "2026-05-31", shiftCode: "T8" }],
        allocations: [],
      },
    });

    expect(input.year).toBe(SLICE_YEAR);
    expect(input.month).toBe(SLICE_MONTH);
    expect(input.employees.length).toBeGreaterThan(0);
    expect(input.shifts.length).toBeGreaterThan(0);
    expect(input.vacationDays).toHaveLength(1);
    expect(input.approvedDayOff).toHaveLength(1);
    expect(input.flightDays).toHaveLength(1);
    expect(input.lockedAllocations).toHaveLength(1);
    expect(input.crossMonthHistory?.assignments).toHaveLength(1);
  });

  it("input vazio (sem cadastros operacionais) é válido", () => {
    const input = minimalPaoInput(2);
    expect(input.vacationDays).toEqual([]);
    expect(input.approvedDayOff).toEqual([]);
    expect(input.flightDays).toEqual([]);
    expect(input.lockedAllocations).toEqual([]);
    expect(input.crossMonthHistory).toBeUndefined();
  });

  it("input parcial aceita apenas férias sem demais cadastros", () => {
    const input = baseGenerationInput({
      vacationDays: [{ employeeUuid: paoUuid(0), date: "2026-06-10" }],
    });
    expect(input.vacationDays).toHaveLength(1);
    expect(input.approvedDayOff).toEqual([]);
  });

  it("mês sem funcionários produz input com employees vazio", () => {
    const input = baseGenerationInput({ employees: [] });
    expect(input.employees).toHaveLength(0);
  });

  it("crossMonthHistory é convertido em previousMonthAssignments", () => {
    const input = baseGenerationInput({
      crossMonthHistory: {
        assignments: [
          { employeeUuid: paoUuid(0), date: "2026-05-30", shiftCode: "T8" },
          { employeeUuid: paoUuid(0), date: "2026-05-31", shiftCode: "T8" },
        ],
        allocations: [{ employeeUuid: paoUuid(0), date: "2026-06-01", label: "ND" }],
      },
    });
    const prev = crossHistoryToPreviousMonthAssignments(input);
    expect(prev?.length).toBeGreaterThan(0);
    expect(prev?.some((a) => a.shiftCode === "T8")).toBe(true);
  });

  it("buildShiftRestrictionMap mapeia UUID → domainId → turnos bloqueados", () => {
    const employees: GenerationInputEmployee[] = [
      { uuid: "emp-a", domainId: 1, employee: { id: 1, name: "PAO A", role: "PAO", seniority: 1 } },
      { uuid: "emp-b", domainId: 2, employee: { id: 2, name: "PAO B", role: "PAO", seniority: 2 } },
    ];
    const map = buildShiftRestrictionMap(employees, [
      { employeeUuid: "emp-a", shiftCode: "T6" },
      { employeeUuid: "emp-b", shiftCode: "t8" },
    ]);
    expect(map?.get(1)?.has("T6")).toBe(true);
    expect(map?.get(2)?.has("T8")).toBe(true);
  });

  it("minimalPaoInput preserva senioridade crescente nos employees", () => {
    const input = minimalPaoInput(3);
    const paos = input.employees.filter((e) => e.employee.role === "PAO");
    expect(paos.map((e) => e.employee.seniority)).toEqual([1, 2, 3]);
  });
});
