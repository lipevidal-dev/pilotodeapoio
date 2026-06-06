import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import { MOCK_EMPLOYEES } from "./fixtures.js";

function toGenEmployees(employees: Employee[]): GenerationInputEmployee[] {
  return employees.map((e, i) => ({
    uuid: `uuid-${e.id}`,
    domainId: i + 1,
    employee: e,
  }));
}

export function baseGenerationInput(
  overrides: Partial<GenerationInput> = {},
): GenerationInput {
  return {
    year: 2026,
    month: 6,
    employees: toGenEmployees(MOCK_EMPLOYEES),
    shifts: DEFAULT_SHIFTS,
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    ...overrides,
  };
}

export function minimalPaoInput(paoCount = 3): GenerationInput {
  const paos: Employee[] = Array.from({ length: paoCount }, (_, i) => ({
    id: i + 1,
    name: `PAO ${i + 1}`,
    role: "PAO" as const,
    seniority: i + 1,
  }));
  const apaos: Employee[] = [
    { id: 100, name: "APAO 1", role: "APAO", seniority: 1 },
    { id: 101, name: "APAO 2", role: "APAO", seniority: 2 },
  ];
  return baseGenerationInput({
    employees: toGenEmployees([...paos, ...apaos]),
  });
}
