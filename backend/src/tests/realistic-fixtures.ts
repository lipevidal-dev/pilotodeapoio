import type { Employee } from "../domain/employee/types.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";

export const REALISTIC_TEST_YEAR = 2026;
export const REALISTIC_TEST_MONTH = 6;

export const REALISTIC_PAOS: Employee[] = [
  { id: 1, name: "PAO Alpha", role: "PAO", seniority: 1 },
  { id: 2, name: "PAO Bravo", role: "PAO", seniority: 2 },
  { id: 3, name: "PAO Charlie", role: "PAO", seniority: 3 },
  { id: 4, name: "PAO Delta", role: "PAO", seniority: 4 },
  { id: 5, name: "PAO Echo", role: "PAO", seniority: 5 },
  { id: 6, name: "PAO Foxtrot", role: "PAO", seniority: 6 },
];

export const REALISTIC_APAOS: Employee[] = [
  { id: 7, name: "APAO 1", role: "APAO", seniority: 1 },
  { id: 8, name: "APAO 2", role: "APAO", seniority: 2 },
  { id: 9, name: "APAO 3", role: "APAO", seniority: 3 },
];

function toGenEmployees(employees: Employee[]): GenerationInputEmployee[] {
  return employees.map((e, i) => ({
    uuid: `real-${e.id}`,
    domainId: i + 1,
    employee: e,
  }));
}

export function realisticGenerationInput(
  overrides: Partial<GenerationInput> = {},
): GenerationInput {
  return {
    year: REALISTIC_TEST_YEAR,
    month: REALISTIC_TEST_MONTH,
    employees: toGenEmployees([...REALISTIC_PAOS, ...REALISTIC_APAOS]),
    shifts: DEFAULT_SHIFTS,
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    ...overrides,
  };
}

export function impossiblePaoInput(): GenerationInput {
  return realisticGenerationInput({
    employees: toGenEmployees([
      { id: 1, name: "PAO Solo", role: "PAO", seniority: 1 },
      { id: 2, name: "APAO 1", role: "APAO", seniority: 1 },
    ]),
  });
}
