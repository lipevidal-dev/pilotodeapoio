import {
  generateScheduleWithRouter,
  resolveActiveEnginePath,
  resolveActiveMotorVersion,
} from "../../domain/schedule/schedule-engine-router.js";
import { buildCleanEngineOptionsFromMotorConfig } from "../../domain/schedule/next-motor/next-motor-engine-options.js";
import { MANUAL_PREALLOC_LABELS } from "../../domain/schedule/operational-labels.js";
import { isPreAllocationRemovedOnClear } from "../../domain/schedule/clear-generated-policy.js";
import { validateCleanGenerationBeforeSave, filterPersistenceBlockingIssues } from "../../domain/schedule/clean-engine/clean-validator.js";
import type { CleanEngineOptions } from "../../domain/schedule/clean-engine/clean-types.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { NextMotorConfigRepository } from "../../infrastructure/repositories/next-motor-config.repository.js";
import { applyMotorEmployeeShiftPrefs } from "../../domain/schedule/next-motor/next-motor-employee-prefs.js";
import {
  buildGenerationInput,
  filterStaleCrossMonthPreAllocations,
  manualAssignmentsToLocked,
  filterLockedAllocationsForEmployees,
  mergeLockedAllocations,
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

  async execute(
    year: number,
    month: number,
    opts: { preferencesOnly?: boolean } = {},
  ): Promise<GenerateScheduleResult> {
    const existing = await this.scheduleRepo.findMonth(year, month);
    if (existing?.status === "PUBLISHED") {
      throw new PublishedScheduleCannotRegenerateError(year, month);
    }

    const employees = await this.scheduleRepo.listActiveEmployees(year, month);
    // Estes colaboradores continuam disponíveis no grid, mas não participam de
    // nenhuma decisão do motor nem são apagados na regeneração.
    const manualScheduleOnlyEmployeeIds = employees
      .filter((employee) => employee.manualScheduleOnly)
      .map((employee) => employee.id);
    const automaticEmployees = employees.filter((employee) => !employee.manualScheduleOnly);
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

    const preAllocRowsRaw =
      existing?.preAllocations ?? (await this.preAllocRepo.findAll({ year, month }));
    const preAllocRows = filterStaleCrossMonthPreAllocations(
      preAllocRowsRaw,
      crossMonthHistory,
    );
    // ND/FOLGA/VOO gerados na rodada anterior são apagados no clearForRegeneration —
    // não podem travar o motor (senão regenerar herda ND órfão e zera T6/T7).
    const lockedFromDb = filterLockedAllocationsForEmployees(
      mergeLockedAllocations(
        preAllocationsToLocked(
          preAllocRows.filter(
            (row) =>
              !manualScheduleOnlyEmployeeIds.includes(row.employeeId) &&
              !isPreAllocationRemovedOnClear(row.label, row.notes),
          ),
        ),
        manualAssignmentsToLocked(
          (existing?.assignments ?? []).filter(
            (row) => !manualScheduleOnlyEmployeeIds.includes(row.employeeId),
          ),
        ),
      ),
      automaticEmployees.map((e) => e.id),
    );

    const skipPersistKeys = new Set(
      lockedFromDb
        .filter((row) => MANUAL_PREALLOC_LABELS.has(row.label.toUpperCase()))
        .map((row) => `${row.employeeUuid}|${row.date}`),
    );

    const input = buildGenerationInput({
      year,
      month,
      employees: automaticEmployees,
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
    engineOptions.preferencesOnly = opts.preferencesOnly ?? false;

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

    await this.scheduleRepo.clearForRegeneration(monthRecord.id, manualScheduleOnlyEmployeeIds);
    await this.scheduleRepo.saveAssignments(monthRecord.id, generated.assignments);
    await this.scheduleRepo.saveGeneratedPreAllocations(
      monthRecord.id,
      generated.allocations,
      skipPersistKeys,
    );

    const dbViolations = validationIssuesToDb(generated.violations, automaticEmployees);
    await this.scheduleRepo.saveViolations(monthRecord.id, dbViolations);

    // Sempre sincroniza (lista vazia limpa spills antigos no mês seguinte).
    await this.scheduleRepo.saveCrossMonthContinuations(
      year,
      month,
      generated.crossMonthPreAllocations ?? [],
    );

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
