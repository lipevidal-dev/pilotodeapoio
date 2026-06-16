import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { validateGenerationBeforeSave } from "../../src/domain/schedule/schedule-generation-validators.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import {
  buildGenerationInput,
  buildShiftRestrictionMap,
} from "../../src/infrastructure/mappers/generation-input.mapper.js";
import {
  mockPrismaEmployeesFromRealistic,
  mockPrismaRoles,
  mockPrismaShifts,
} from "../../src/tests/helpers/generate-schedule-mocks.js";

const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

const employees = mockPrismaEmployeesFromRealistic();
const shifts = mockPrismaShifts();
const restrictionRows = [{ employeeUuid: uuid, shiftCode: "T8" as const }];
const noFlight = days.map((date) => ({ employeeUuid: uuid, date }));

const input = buildGenerationInput({
  year: 2026,
  month: 6,
  employees,
  shifts,
  roles: mockPrismaRoles(),
  lockedAllocations: [],
  vacationDays: [],
  vacationReturnDays: [],
  crossMonthHistory: undefined,
  shiftRestrictionRows: restrictionRows,
  preferredShiftRows: [],
  noFlightDates: noFlight,
  approvedDayOff: [],
  flightDays: [],
});

console.log("restrictions map:", buildShiftRestrictionMap(input.employees, restrictionRows));

const engine = new RealScheduleEngine();
const t0 = Date.now();
const result = engine.generate(input);
console.log("elapsed ms:", Date.now() - t0);
console.log("coverageMissingCount:", result.summary?.coverageMissingCount);

const notes = (result.summary?.realMotorReport as { stepNotes?: string[] })?.stepNotes ?? [];
console.log("15c notes:", notes.filter((n) => n.includes("[15c]")));
console.log("14 notes:", notes.filter((n) => n.includes("[14]")));

const val = validateGenerationBeforeSave(input, result);
console.log("criticalCount:", val.criticalCount);
for (const i of val.issues.filter((x) => x.level === "CRITICAL" || x.severity === "CRÍTICA")) {
  console.log("-", i.type, i.date, i.detail);
}
