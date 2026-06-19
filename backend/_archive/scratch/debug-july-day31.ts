/**
 * Debug cobertura T8 dia 31 / cross-month — julho/2026 com dados reais.
 * Uso: docker compose exec backend npx tsx _archive/scratch/debug-july-day31.ts
 */
import { CalendarRepository } from "../../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../src/infrastructure/repositories/schedule.repository.js";
import { NextMotorConfigRepository } from "../../src/infrastructure/repositories/next-motor-config.repository.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../../src/infrastructure/mappers/generation-input.mapper.js";
import { buildCleanEngineOptionsFromMotorConfig } from "../../src/domain/schedule/next-motor/next-motor-engine-options.js";
import { applyMotorEmployeeShiftPrefs } from "../../src/domain/schedule/next-motor/next-motor-employee-prefs.js";
import { generateCleanSchedule } from "../../src/domain/schedule/clean-engine/clean-engine.js";
import { CleanWorkspace } from "../../src/domain/schedule/clean-engine/clean-workspace.js";
import { tryAssignT8CoverageGap } from "../../src/domain/schedule/clean-engine/clean-t8-blocks.js";
import { canPlaceT8BlockCrossMonthEnd as canCross } from "../../src/domain/schedule/clean-engine/clean-cross-month-t8.js";

const YEAR = 2026;
const MONTH = 7;
const GAP = "2026-07-31";

async function main() {
  const scheduleRepo = new ScheduleRepository();
  const calendarRepo = new CalendarRepository();
  const preAllocRepo = new PreAllocationRepository();
  const nextMotorRepo = new NextMotorConfigRepository();

  const employees = await scheduleRepo.listActiveEmployees();
  const shifts = await scheduleRepo.listShifts(true);
  const roles = await scheduleRepo.listRoles(true);
  const vacationDays = await calendarRepo.listVacationDaysForMonth(YEAR, MONTH);
  const vacationReturnDays = await calendarRepo.listVacationReturnDaysForMonth(YEAR, MONTH);
  const crossMonthHistory = await scheduleRepo.loadCrossMonthHistory(YEAR, MONTH);
  const shiftRestrictionRows = await scheduleRepo.listShiftRestrictionsForMonth(YEAR, MONTH);
  const preferredShiftRows = await scheduleRepo.listPreferredShiftsForMonth(YEAR, MONTH);
  const noFlightDates = await scheduleRepo.listNoFlightDatesForMonth(YEAR, MONTH);
  const approvedDayOff = await calendarRepo.listApprovedDayOffForMonth(YEAR, MONTH);
  const flightDays = await calendarRepo.listFlightDaysForMonth(YEAR, MONTH);
  const existing = await scheduleRepo.findMonth(YEAR, MONTH);
  const preAllocRows =
    existing?.preAllocations ?? (await preAllocRepo.findAll({ year: YEAR, month: MONTH }));
  const lockedFromDb = preAllocationsToLocked(preAllocRows);

  const motorCfg = await nextMotorRepo.getFullConfig();
  const shiftPrefs = applyMotorEmployeeShiftPrefs({
    preferredShiftRows,
    shiftRestrictionRows,
    employeePrefs: motorCfg.employeePrefs,
    shifts,
  });

  const input = buildGenerationInput({
    year: YEAR,
    month: MONTH,
    employees,
    shifts,
    roles,
    lockedAllocations: lockedFromDb,
    vacationDays,
    vacationReturnDays,
    crossMonthHistory,
    shiftRestrictionRows: shiftPrefs.shiftRestrictionRows,
    preferredShiftRows: shiftPrefs.preferredShiftRows,
    noFlightDates,
    approvedDayOff,
    flightDays,
  });

  const engineOptions = buildCleanEngineOptionsFromMotorConfig(motorCfg, shifts);
  const result = generateCleanSchedule(input, engineOptions);

  console.log("coverageGaps:", result.summary.coverageGaps);
  console.log(
    "T8 day 31:",
    result.assignments.filter((a) => a.date === GAP && a.shiftCode.toUpperCase() === "T8"),
  );
  console.log("crossMonthPreAllocations:", result.crossMonthPreAllocations);
  const names = new Map(employees.map((e) => [e.uuid, e.name]));
  console.log(
    "T8 assignee:",
    names.get(
      result.assignments.find((a) => a.date === GAP && a.shiftCode.toUpperCase() === "T8")
        ?.employeeUuid ?? "",
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
