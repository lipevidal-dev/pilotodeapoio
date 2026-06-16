import { realScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { buildGenerationInput, preAllocationsToLocked } from "../../src/infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../src/infrastructure/repositories/schedule.repository.js";

const scheduleRepo = new ScheduleRepository();
const calendarRepo = new CalendarRepository();
const preAllocRepo = new PreAllocationRepository();
const YEAR = 2026;
const MONTH = 7;

const employees = await scheduleRepo.listActiveEmployees();
const shifts = await scheduleRepo.listShifts(true);
const roles = await scheduleRepo.listRoles(true);
const existing = await scheduleRepo.findMonth(YEAR, MONTH);
const preAllocRows = existing?.preAllocations ?? (await preAllocRepo.findAll({ year: YEAR, month: MONTH }));

const input = buildGenerationInput({
  year: YEAR,
  month: MONTH,
  employees,
  shifts,
  roles,
  lockedAllocations: preAllocationsToLocked(preAllocRows),
  vacationDays: await calendarRepo.listVacationDaysForMonth(YEAR, MONTH),
  vacationReturnDays: await calendarRepo.listVacationReturnDaysForMonth(YEAR, MONTH),
  crossMonthHistory: await scheduleRepo.loadCrossMonthHistory(YEAR, MONTH),
  shiftRestrictionRows: await scheduleRepo.listShiftRestrictionsForMonth(YEAR, MONTH),
  preferredShiftRows: await scheduleRepo.listPreferredShiftsForMonth(YEAR, MONTH),
  noFlightDates: await scheduleRepo.listNoFlightDatesForMonth(YEAR, MONTH),
  approvedDayOff: await calendarRepo.listApprovedDayOffForMonth(YEAR, MONTH),
  flightDays: await calendarRepo.listFlightDaysForMonth(YEAR, MONTH),
});

console.log("restrictions:", input.shiftRestrictions?.size ?? 0);

const result = realScheduleEngine.generate(input);
console.log("coverageGaps:", result.summary.coverageGaps);

const ws = new GenerationWorkspace(input);
for (const a of result.assignments) {
  const did = ws.uuidToDomain.get(a.employeeUuid);
  if (did != null) ws.planned.set(`${did}|${a.date}`, a.shiftCode);
}
ws.allocations.push(...result.allocations);
ws.clearCoverageGapsCache();
console.log("gaps:", ws.listCoverageGaps());

const val = await import("../../src/domain/schedule/schedule-generation-validators.js");
const saveVal = val.validateGenerationBeforeSave(input, result);
console.log("critical:", saveVal.criticalCount, saveVal.issues.filter(i => i.level === "CRITICAL").map(i => i.type));
