import { realScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { buildGenerationInput, preAllocationsToLocked } from "../../src/infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../src/infrastructure/repositories/schedule.repository.js";
import { repairAllCoverageGapsFinal, repairCoverageGapsBeforeSave } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";

const scheduleRepo = new ScheduleRepository();
const calendarRepo = new CalendarRepository();
const preAllocRepo = new PreAllocationRepository();
const input = buildGenerationInput({
  year: 2026,
  month: 7,
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
ws.clearCoverageGapsCache();
console.log("post-gen gaps:", ws.listCoverageGaps());

const day = "2026-07-19";
console.log("T7 holder:", ws.findPaoOnShift(day, "T7"));
console.log("T6 holder:", ws.findPaoOnShift(day, "T6"));
console.log("T8 holder:", ws.findPaoOnShift(day, "T8"));

for (const c of ws.paoEmps) {
  const did = ws.uuidToDomain.get(c.uuid)!;
  const code = ws.planned.get(`${did}|${day}`);
  const blocked = ws.blocked.get(`${did}|${day}`);
  if (code || blocked) console.log(c.employee.name, code ?? blocked);
}

const repair = repairCoverageGapsBeforeSave(ws);
console.log("pre-save repair:", repair);
ws.clearCoverageGapsCache();
console.log("gaps after pre-save fn on dirty ws:", ws.listCoverageGaps());

if (repair.persistAssignments) {
  console.log("would persist", repair.persistAssignments.length, "assignments");
}

const scratchRepair = repairAllCoverageGapsFinal(ws, ws.ensureRateioContext());
console.log("direct final repair:", scratchRepair, "gaps:", ws.listCoverageGaps());
