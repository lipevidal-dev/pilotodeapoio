import { RealScheduleEngine } from "../../domain/schedule/real-schedule-engine.js";
import {
  ENGINE_PATH,
  MOTOR_VERSION_ID,
} from "../../domain/schedule/real-schedule-types.js";
import { MANUAL_PREALLOC_LABELS } from "../../domain/schedule/operational-labels.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../../infrastructure/mappers/generation-input.mapper.js";
import {
  issueToApiViolation,
  validationIssuesToDb,
} from "../../infrastructure/mappers/violation.mapper.js";
import { PublishedScheduleCannotRegenerateError } from "../errors/schedule.errors.js";

export interface GenerateScheduleResult {
  scheduleMonthId: string;
  status: "GENERATED";
  assignmentsCreated: number;
  allocationsCreated: number;
  violations: Array<{
    severity: string;
    ruleCode: string;
    message: string;
    date: string;
    employee: string;
    detail: string;
  }>;
  summary: Record<string, unknown>;
  success: boolean;
  suggestions: string[];
  motorVersion: typeof MOTOR_VERSION_ID;
  enginePath: typeof ENGINE_PATH;
  realEngineExecuted: true;
}

export class GenerateScheduleUseCase {
  constructor(
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly calendarRepo = new CalendarRepository(),
    private readonly preAllocRepo = new PreAllocationRepository(),
    private readonly engine = new RealScheduleEngine(),
  ) {}

  async execute(year: number, month: number): Promise<GenerateScheduleResult> {
    const existing = await this.scheduleRepo.findMonth(year, month);
    if (existing?.status === "PUBLISHED") {
      throw new PublishedScheduleCannotRegenerateError(year, month);
    }

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

    const preAllocRows =
      existing?.preAllocations ?? (await this.preAllocRepo.findAll({ year, month }));
    const lockedFromDb = preAllocationsToLocked(preAllocRows);

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
      noFlightDates,
      approvedDayOff,
      flightDays,
    });

    const generated = this.engine.generate(input);
    const monthRecord = await this.scheduleRepo.upsertGeneratedMonth(year, month);

    await this.scheduleRepo.clearForRegeneration(monthRecord.id);
    await this.scheduleRepo.saveAssignments(monthRecord.id, generated.assignments);
    await this.scheduleRepo.saveGeneratedPreAllocations(
      monthRecord.id,
      generated.allocations,
      skipPersistKeys,
    );

    const dbViolations = validationIssuesToDb(generated.violations, employees);
    await this.scheduleRepo.saveViolations(monthRecord.id, dbViolations);

    const summary = {
      ...generated.summary,
      motorVersion: MOTOR_VERSION_ID,
      enginePath: ENGINE_PATH,
      realEngineExecuted: true,
    };

    return {
      scheduleMonthId: monthRecord.id,
      status: "GENERATED",
      assignmentsCreated: generated.assignments.length,
      allocationsCreated: generated.allocations.length,
      violations: generated.violations.map(issueToApiViolation),
      summary: summary as unknown as Record<string, unknown>,
      success: generated.success,
      suggestions: generated.suggestions,
      motorVersion: MOTOR_VERSION_ID,
      enginePath: ENGINE_PATH,
      realEngineExecuted: true,
    };
  }
}

export const generateScheduleUseCase = new GenerateScheduleUseCase();
