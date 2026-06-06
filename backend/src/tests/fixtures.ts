import type { Employee } from "../domain/employee/types.js";
import type { ScheduleContext } from "../domain/schedule/types.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 1, name: "PAO SILVA", role: "PAO", seniority: 1 },
  { id: 2, name: "PAO SANTOS", role: "PAO", seniority: 2 },
  { id: 3, name: "PAO OLIVEIRA", role: "PAO", seniority: 3 },
  { id: 4, name: "APAO LIMA", role: "APAO", seniority: 1 },
  { id: 5, name: "APAO COSTA", role: "APAO", seniority: 2 },
];

export function emptyContext(year = 2026, month = 6): ScheduleContext {
  return {
    year,
    month,
    employees: MOCK_EMPLOYEES,
    shifts: DEFAULT_SHIFTS,
    assignments: [],
    allocations: [],
  };
}
