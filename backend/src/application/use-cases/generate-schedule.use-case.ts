import { generateScheduleWithRouter, resolveActiveMotorVersion } from "../../domain/schedule/schedule-engine-router.js";
import {
  ENGINE_PATH,
  ENGINE_PATH_V4,
  ENGINE_PATH_V5,
  MOTOR_VERSION_V4,
  MOTOR_VERSION_V5,
  MOTOR_VERSION_V6,
} from "../../domain/schedule/real-schedule-types.js";
import { MANUAL_PREALLOC_LABELS } from "../../domain/schedule/operational-labels.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../../infrastructure/mappers/generation-input.mapper.js";
import { validateGenerationBeforeSave } from "../../domain/schedule/schedule-generation-validators.js";
import {
  issueToApiViolation,
  validationIssuesToDb,
} from "../../infrastructure/mappers/violation.mapper.js";
import {
  PublishedScheduleCannotRegenerateError,
  SchedulePersistenceValidationError,
} from "../errors/schedule.errors.js";

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
  motorVersion: typeof MOTOR_VERSION_V4 | typeof MOTOR_VERSION_V5 | typeof MOTOR_VERSION_V6;
  enginePath: typeof ENGINE_PATH | typeof ENGINE_PATH_V4 | typeof ENGINE_PATH_V5;
  realEngineExecuted: true;
  /** Preenchido quando validateBeforeSave falha antes da persistência. */
  persistenceBlocked?: boolean;
  persistenceValidationIssues?: Array<{
    severity: string;
    ruleCode: string;
    message: string;
    date: string;
    employee: string;
    detail: string;
  }>;
}

export class GenerateScheduleUseCase {
  constructor(
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly calendarRepo = new CalendarRepository(),
    private readonly preAllocRepo = new PreAllocationRepository(),
    private readonly engine: { generate: typeof generateScheduleWithRouter } = {
      generate: generateScheduleWithRouter,
    },
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
    const preferredShiftRows = await this.scheduleRepo.listPreferredShiftsForMonth(year, month);
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

    const specificShiftDayPreferences =
      await this.scheduleRepo.listSpecificShiftDayPreferencesForMonth(year, month);

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
      specificShiftDayPreferences,
      noFlightDates,
      approvedDayOff,
      flightDays,
    });

    const generated = this.engine.generate(input);
    const motorVersion = resolveActiveMotorVersion();
    const enginePath =
      motorVersion === MOTOR_VERSION_V4 ? ENGINE_PATH_V4 : ENGINE_PATH_V5;

    const saveValidation = validateGenerationBeforeSave(input, generated);
    if (saveValidation.criticalCount > 0) {
      const apiIssues = saveValidation.issues.map(issueToApiViolation);
      throw new SchedulePersistenceValidationError({
        stage: saveValidation.stage,
        criticalCount: saveValidation.criticalCount,
        issues: apiIssues.map((v) => ({
          level: "CRITICAL" as const,
          ruleCode: v.ruleCode,
          message: v.message,
          date: v.date,
          employee: v.employee,
          detail: v.detail,
        })),
      });
    }

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
      motorVersion,
      enginePath,
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
      motorVersion,
      enginePath,
      realEngineExecuted: true,
    };
  }
}

export const generateScheduleUseCase = new GenerateScheduleUseCase();
