import { validateSchedule } from "../../domain/rules/engine.js";
import { buildExtendedSummary } from "../../domain/schedule/_legacy/generation-summary.js";
import { GenerationWorkspace } from "../../domain/schedule/_legacy/generation-workspace.js";
import { MANUAL_PREALLOC_LABELS } from "../../domain/schedule/operational-labels.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../../infrastructure/mappers/generation-input.mapper.js";
import {
  issueToApiViolation,
  validationIssuesToDb,
} from "../../infrastructure/mappers/violation.mapper.js";
import {
  ScheduleMonthNotFoundError,
  ScheduleNotGeneratedError,
} from "../errors/schedule.errors.js";

export interface GenerateFlightsResult {
  scheduleMonthId: string;
  flightsCreated: number;
  violations: Array<{
    severity: string;
    ruleCode: string;
    message: string;
    date: string;
    employee: string;
    detail: string;
  }>;
  summary: Record<string, unknown>;
}

export class GenerateFlightsUseCase {
  constructor(
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly calendarRepo = new CalendarRepository(),
  ) {}

  async execute(scheduleMonthId: string): Promise<GenerateFlightsResult> {
    const record = await this.scheduleRepo.findMonthById(scheduleMonthId);
    if (!record) throw new ScheduleMonthNotFoundError(scheduleMonthId);
    if (record.status !== "GENERATED") {
      throw new ScheduleNotGeneratedError(record.status);
    }

    const { year, month } = record;
    const employees = await this.scheduleRepo.listActiveEmployees();
    const shifts = await this.scheduleRepo.listShifts(true);
    const roles = await this.scheduleRepo.listRoles(true);

    const vacationDays = await this.calendarRepo.listVacationDaysForMonth(year, month);
    const vacationReturnDays = await this.calendarRepo.listVacationReturnDaysForMonth(year, month);
    const approvedDayOff = await this.calendarRepo.listApprovedDayOffForMonth(year, month);
    const flightDays = await this.calendarRepo.listFlightDaysForMonth(year, month);
    const crossMonthHistory = await this.scheduleRepo.loadCrossMonthHistory(year, month);
    const shiftRestrictionRows = await this.scheduleRepo.listShiftRestrictionsForMonth(year, month);
    const preferredShiftRows = await this.scheduleRepo.listPreferredShiftsForMonth(year, month);
    const noFlightDates = await this.scheduleRepo.listNoFlightDatesForMonth(year, month);

    const lockedFromDb = preAllocationsToLocked(record.preAllocations);
    const skipPersistKeys = new Set(
      lockedFromDb
        .filter((row) => MANUAL_PREALLOC_LABELS.has(row.label.toUpperCase()))
        .map((row) => `${row.employeeUuid}|${row.date}`),
    );

    const input = buildGenerationInput({
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
      preferredShiftRows,
      noFlightDates,
      approvedDayOff,
      flightDays,
    });

    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.seedAssignments(
      record.assignments.map((a) => ({
        employeeUuid: a.employeeId,
        date: isoDateKey(a.date),
        shiftCode: a.shiftCode,
      })),
    );

    const created = ws.applyFlightsToAvailablePaoDays();

    await this.scheduleRepo.saveGeneratedPreAllocations(scheduleMonthId, created, skipPersistKeys);

    const ctx = ws.toScheduleContext();
    const violations = validateSchedule(ctx);
    const dbViolations = validationIssuesToDb(violations, employees);
    await this.scheduleRepo.saveViolations(scheduleMonthId, dbViolations);

    const folgasPerPao: Record<string, number> = {};
    for (const c of ws.paoEmps) {
      folgasPerPao[c.employee.name] = ws.countRest(c.uuid);
    }

    const summary = buildExtendedSummary(ws, violations, {
      totalAssignments: ws.toAssignments().length,
      totalAllocations: ws.allocations.length,
      paoCount: ws.paoEmps.length,
      apaoCount: ws.apaoEmps.length,
      folgasPerPao,
      coverageGaps: ws.listCoverageGaps().length,
      generationMs: 0,
    });

    return {
      scheduleMonthId,
      flightsCreated: created.length,
      violations: violations.map(issueToApiViolation),
      summary: summary as unknown as Record<string, unknown>,
    };
  }
}

export const generateFlightsUseCase = new GenerateFlightsUseCase();
