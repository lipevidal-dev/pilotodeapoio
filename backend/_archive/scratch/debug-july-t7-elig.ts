import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { buildGenerationInput, preAllocationsToLocked } from "../../src/infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../src/infrastructure/repositories/schedule.repository.js";
import { realScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";
import { sortPaoForCoverageCandidates } from "../../src/domain/schedule/real-schedule-turn-rateio.js";

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
ws.applyHardBlocks();
for (const a of result.assignments) {
  const did = ws.uuidToDomain.get(a.employeeUuid);
  if (did != null) ws.planned.set(assignmentKey(did, a.date), a.shiftCode);
}
ws.allocations.push(...result.allocations.map((a) => ({ ...a })));
ws.initRateioContext();
ws.syncRateioContext();

const day = "2026-07-19";
const di = ws.days.indexOf(day);
const candidates = sortPaoForCoverageCandidates(ws, di, undefined, "T7");
console.log("candidates:", candidates.map((c) => c.employee.name));

for (const c of candidates) {
  const normal = ws.tryAssignShift(c.uuid, day, "T7");
  if (normal) {
    console.log("OK normal:", c.employee.name);
    ws.unassignShift(c.uuid, day);
    continue;
  }
  const emerg = ws.tryAssignShift(c.uuid, day, "T7", true);
  const detail = ws.tryAssignShiftDetailed(c.uuid, day, "T7", true);
  console.log(c.employee.name, "normal=false emerg=", emerg, detail.rejectReason ?? detail);
}
