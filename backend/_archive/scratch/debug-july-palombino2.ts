import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { buildGenerationInput, preAllocationsToLocked } from "../../src/infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../src/infrastructure/repositories/schedule.repository.js";
import { realScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";
import { addDays } from "../../src/domain/rules/dates.js";
import { has12hRest } from "../../src/domain/rules/time.js";
import { sortPaoForT8CoverageCandidates } from "../../src/domain/schedule/t8-coverage-priority.js";

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

const palombino = ws.paoEmps.find((e) => e.employee.name.includes("Palombino"))!;
const day = "2026-07-19";
const prev = addDays(day, -1);
const did = ws.uuidToDomain.get(palombino.uuid)!;
const continuity = ws["mergedPlannedForContinuity"]();

console.log("Palombino uuid", palombino.uuid);
for (const d of ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21"]) {
  const code = ws.planned.get(`${did}|${d}`);
  const blocked = ws.blocked.get(`${did}|${d}`);
  const nd = ws.allocations.find((a) => a.employeeUuid === palombino.uuid && a.date === d);
  console.log(d, code ?? blocked ?? nd?.label ?? "-");
}

console.log("T8 holder prev:", ws.findPaoOnShift(prev, "T8"));
console.log("12h Palombino T7:", has12hRest(did, day, "T7", continuity, ws.shiftMap).ok);

const di = ws.days.indexOf(prev);
const cands = sortPaoForT8CoverageCandidates(ws, di, true).filter((c) => c.uuid !== palombino.uuid);
console.log("T8 candidates for", prev, ":", cands.map((c) => c.employee.name).slice(0, 5));

for (const c of cands.slice(0, 8)) {
  const ok = ws.canPlaceT8Block(c.uuid, addDays(prev, -1), true);
  const ok2 = ws.canPlaceT8Block(c.uuid, prev, true);
  console.log(c.employee.name, "block@prev-1", ok, "block@prev", ok2);
}
