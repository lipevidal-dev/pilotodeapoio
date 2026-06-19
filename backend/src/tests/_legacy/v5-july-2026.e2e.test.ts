import { describe, expect, it } from "vitest";
import { realScheduleEngineV5 } from "../domain/schedule/real-schedule-engine-v5.js";
import { assertV57July2026Criteria } from "../domain/schedule/v5-july-2026-criteria.js";
import { buildGenerationInput, preAllocationsToLocked } from "../infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../infrastructure/repositories/schedule.repository.js";

const YEAR = 2026;
const MONTH = 7;
const DB_URL = process.env.DATABASE_URL ?? "";

async function loadJuly2026Input() {
  const scheduleRepo = new ScheduleRepository();
  const calendarRepo = new CalendarRepository();
  const preAllocRepo = new PreAllocationRepository();

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

  return buildGenerationInput({
    year: YEAR,
    month: MONTH,
    employees,
    shifts,
    roles,
    lockedAllocations: preAllocationsToLocked(preAllocRows),
    vacationDays,
    vacationReturnDays,
    crossMonthHistory,
    shiftRestrictionRows,
    preferredShiftRows,
    noFlightDates,
    approvedDayOff,
    flightDays,
  });
}

describe.skipIf(!DB_URL.includes("5434") && !DB_URL.includes("5432"))(
  "V5.7 e2e — julho/2026 critérios fixos (motor V5)",
  () => {
    it("gaps=0, Lucas/Gustavo/Alexandre>=8, T8 pref 100%, locks intactos, rateio OK", async () => {
      const input = await loadJuly2026Input();
      const result = realScheduleEngineV5.generate(input);

      const criteria = assertV57July2026Criteria(input, result);
      expect(criteria.failures, criteria.failures.join("\n")).toEqual([]);

      const stepNotes = result.summary.realMotorReport?.stepNotes;
      const notes = Array.isArray(stepNotes) ? stepNotes.join("\n") : "";
      expect(notes).toContain("V5.7 GUARDS");
      expect(notes).not.toContain("V4 PÓS-ENFORCE");
    }, 600_000);
  },
);
