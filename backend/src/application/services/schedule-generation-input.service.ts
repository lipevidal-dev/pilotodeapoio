import { MANUAL_PREALLOC_LABELS } from "../../domain/schedule/operational-labels.js";
import type { GenerationInput } from "../../domain/schedule/generation-types.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../../infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";

export class ScheduleGenerationInputService {
  constructor(
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly calendarRepo = new CalendarRepository(),
    private readonly preAllocRepo = new PreAllocationRepository(),
  ) {}

  async loadForMonth(year: number, month: number): Promise<GenerationInput> {
    const existing = await this.scheduleRepo.findMonth(year, month);
    const employees = await this.scheduleRepo.listActiveEmployees();
    const shifts = await this.scheduleRepo.listShifts(true);
    const roles = await this.scheduleRepo.listRoles(true);

    const vacationDays = await this.calendarRepo.listVacationDaysForMonth(year, month);
    const vacationReturnDays = await this.calendarRepo.listVacationReturnDaysForMonth(year, month);
    const crossMonthHistory = await this.scheduleRepo.loadCrossMonthHistory(year, month);
    const shiftRestrictionRows = await this.scheduleRepo.listShiftRestrictionsForMonth(year, month);
    const noFlightDates = await this.scheduleRepo.listNoFlightDatesForMonth(year, month);
    const approvedDayOff = await this.calendarRepo.listApprovedDayOffForMonth(year, month);
    const flightDays = await this.calendarRepo.listFlightDaysForMonth(year, month);

    const preAllocRows = existing?.preAllocations ?? (await this.preAllocRepo.findAll({ year, month }));
    const lockedFromDb = preAllocationsToLocked(preAllocRows);

    return buildGenerationInput({
      year,
      month,
      employees,
      shifts,
      roles,
      lockedAllocations: lockedFromDb,
      vacationDays,
      vacationReturnDays,
      crossMonthHistory,
      shiftRestrictionRows,
      noFlightDates,
      approvedDayOff,
      flightDays,
    });
  }

  skipPersistKeysFromLocked(lockedFromDb: ReturnType<typeof preAllocationsToLocked>): Set<string> {
    return new Set(
      lockedFromDb
        .filter((row) => MANUAL_PREALLOC_LABELS.has(row.label.toUpperCase()))
        .map((row) => `${row.employeeUuid}|${row.date}`),
    );
  }
}

export const scheduleGenerationInputService = new ScheduleGenerationInputService();
