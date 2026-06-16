import { GenerateScheduleUseCase } from "../../src/application/use-cases/generate-schedule.use-case.js";
import { validateGenerationBeforeSave } from "../../src/domain/schedule/schedule-generation-validators.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import {
  mockPrismaEmployeesFromRealistic,
  mockPrismaRoles,
  mockPrismaShifts,
} from "../../src/tests/helpers/generate-schedule-mocks.js";

const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => {
  const d = String(i + 1).padStart(2, "0");
  return `2026-06-${d}`;
});

const employees = mockPrismaEmployeesFromRealistic();
const useCase = new GenerateScheduleUseCase(
  {
    findMonth: async () => null,
    listActiveEmployees: async () => employees,
    listShifts: async () => mockPrismaShifts(),
    listRoles: async () => mockPrismaRoles(),
    loadCrossMonthHistory: async () => undefined,
    listShiftRestrictionsForMonth: async () => [{ employeeUuid: uuid, shiftCode: "T8" }],
    listPreferredShiftsForMonth: async () => [],
    listNoFlightDatesForMonth: async () => days.map((date) => ({ employeeUuid: uuid, date })),
    upsertGeneratedMonth: async () => ({ id: "month-2" }),
    clearForRegeneration: async () => {},
    saveAssignments: async () => {},
    saveGeneratedPreAllocations: async () => {},
    saveViolations: async () => {},
  } as never,
  {
    listVacationDaysForMonth: async () => [],
    listVacationReturnDaysForMonth: async () => [],
    listApprovedDayOffForMonth: async () => [],
    listFlightDaysForMonth: async () => [],
  } as never,
  { findAll: async () => [] } as never,
);

// Bypass persistence validation - call engine internals via realistic input path
import { buildGenerationInput } from "../../src/infrastructure/mappers/generation-input.mapper.js";

const input = await buildGenerationInput({
  year: 2026,
  month: 6,
  employees,
  shifts: mockPrismaShifts(),
  roles: mockPrismaRoles(),
  shiftRestrictions: [{ employeeUuid: uuid, shiftCode: "T8" }],
  noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
  lockedAllocations: [],
  preAllocations: [],
  crossMonthHistory: undefined,
  preferredShifts: [],
});

import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
const result = new RealScheduleEngine().generate(input);
const v = validateGenerationBeforeSave(input, result);
console.log("critical", v.criticalCount);
for (const i of v.issues.filter((x) => x.level === "CRITICAL" || x.severity === "CRÍTICA")) {
  console.log(i.type, i.detail?.slice(0, 120));
}
console.log("coverageMissing", result.summary.coverageMissingCount);
console.log(
  "15c note",
  (result.summary.realMotorReport as { stepNotes?: string[] }).stepNotes?.find((n) => n.includes("[15c]")),
);
