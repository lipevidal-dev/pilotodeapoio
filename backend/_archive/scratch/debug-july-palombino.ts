import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { buildGenerationInput, preAllocationsToLocked } from "../../src/infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../src/infrastructure/repositories/schedule.repository.js";
import { realScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";

const scheduleRepo = new ScheduleRepository();
const calendarRepo = new CalendarRepository();
const preAllocRepo = new PreAllocationRepository();
const input = buildGenerationInput({
  year: 2026, month: 7,
  employees: await scheduleRepo.listActiveEmployees(),
  shifts: await scheduleRepo.listShifts(true),
  roles: await scheduleRepo.listRoles(true),
  lockedAllocations: preAllocationsToLocked(
    (await scheduleRepo.findMonth(2026, 7))?.preAllocations ??
      (await preAllocRepo.findAll({ year: 2026, month: 7 })),
  ),
  vacationDays: await calendarRepo.listVacationDaysForMonth(2026, 7),
  vacationReturnDays: await calendarRepo.listVacationReturnDaysForMonth(2026, 7),
  crossMonthHistory: await scheduleRepo.loadCrossMonthHistory(2026, 7),
  shiftRestrictionRows: await scheduleRepo.listShiftRestrictionsForMonth(2026, 7),
  preferredShiftRows: await scheduleRepo.listPreferredShiftsForMonth(2026, 7),
  noFlightDates: await scheduleRepo.listNoFlightDatesForMonth(2026, 7),
  approvedDayOff: await calendarRepo.listApprovedDayOffForMonth(2026, 7),
  flightDays: await calendarRepo.listFlightDaysForMonth(2026, 7),
});

const result = realScheduleEngine.generate(input);
const ws = new GenerationWorkspace(input);
for (const a of result.assignments) {
  const did = ws.uuidToDomain.get(a.employeeUuid);
  if (did != null) ws.planned.set(assignmentKey(did, a.date), a.shiftCode);
}
for (const c of ws.paoEmps) {
  const did = ws.uuidToDomain.get(c.uuid)!;
  for (const d of ["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"]) {
    const code = ws.planned.get(`${did}|${d}`);
    if (code) console.log(d, c.employee.name, code);
  }
}
