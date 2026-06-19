import {
  generateScheduleWithRouter,
  resolveActiveEnginePath,
  resolveActiveMotorVersion,
} from "../../domain/schedule/schedule-engine-router.js";
import { buildCleanEngineOptionsFromMotorConfig } from "../../domain/schedule/next-motor/next-motor-engine-options.js";
import { MANUAL_PREALLOC_LABELS } from "../../domain/schedule/operational-labels.js";
import { validateCleanGenerationBeforeSave, filterPersistenceBlockingIssues } from "../../domain/schedule/clean-engine/clean-validator.js";
import type { CleanEngineOptions } from "../../domain/schedule/clean-engine/clean-types.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { NextMotorConfigRepository } from "../../infrastructure/repositories/next-motor-config.repository.js";
import { applyMotorEmployeeShiftPrefs } from "../../domain/schedule/next-motor/next-motor-employee-prefs.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../../infrastructure/mappers/generation-input.mapper.js";
import {
  issueToApiViolation,
  validationIssuesToDb,
} from "../../infrastructure/mappers/violation.mapper.js";
import {
  PublishedScheduleCannotRegenerateError,
  SchedulePersistenceValidationError,
  NextMotorScopeEmptyError,
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
  motorVersion: ReturnType<typeof resolveActiveMotorVersion>;
  enginePath: ReturnType<typeof resolveActiveEnginePath>;
  realEngineExecuted: true;
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
    private readonly nextMotorRepo = new NextMotorConfigRepository(),
    private readonly engine: {
      generate: (input: Parameters<typeof generateScheduleWithRouter>[0], options?: CleanEngineOptions) => ReturnType<typeof generateScheduleWithRouter>;
    } = {
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

    const motorCfg = await this.nextMotorRepo.getFullConfig();
    const shiftPrefs = applyMotorEmployeeShiftPrefs({
      preferredShiftRows,
      shiftRestrictionRows,
      employeePrefs: motorCfg.employeePrefs,
      shifts,
    });

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
      shiftRestrictionRows: shiftPrefs.shiftRestrictionRows,
      preferredShiftRows: shiftPrefs.preferredShiftRows,
      noFlightDates,
      approvedDayOff,
      flightDays,
      employeePrefs: motorCfg.employeePrefs,
    });

    const engineOptions = buildCleanEngineOptionsFromMotorConfig(motorCfg, shifts);

    if (
      engineOptions.scopeEmployeeUuids &&
      engineOptions.scopeEmployeeUuids.length === 0
    ) {
      throw new NextMotorScopeEmptyError();
    }

    const generated = this.engine.generate(input, engineOptions);
    const motorVersion = (engineOptions.motorVersion ??
      resolveActiveMotorVersion()) as ReturnType<typeof resolveActiveMotorVersion>;
    const enginePath = resolveActiveEnginePath();

    const saveValidation = validateCleanGenerationBeforeSave(input, generated, engineOptions);
    const persistenceBlockers = filterPersistenceBlockingIssues(
      saveValidation.issues,
      engineOptions,
    );
    if (persistenceBlockers.length > 0) {
      const uuidToName = new Map(input.employees.map((e) => [e.uuid, e.employee.name]));
      const apiIssues = persistenceBlockers.map(issueToApiViolation);
      throw new SchedulePersistenceValidationError({
        stage: saveValidation.stage,
        criticalCount: persistenceBlockers.length,
        issues: apiIssues.map((v) => ({
          level: "CRITICAL" as const,
          ruleCode: v.ruleCode,
          message: v.message,
          date: v.date,
          employee: uuidToName.get(v.employee) ?? (v.employee || "—"),
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

    if (generated.crossMonthPreAllocations && generated.crossMonthPreAllocations.length > 0) {
      await this.scheduleRepo.saveCrossMonthContinuations(
        year,
        month,
        generated.crossMonthPreAllocations,
      );
    }

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
