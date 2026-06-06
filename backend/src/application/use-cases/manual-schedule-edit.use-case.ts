import { ScheduleMonthNotFoundError } from "../errors/schedule.errors.js";
import {
  ManualEditBlockedError,
  SchedulePublishedCannotEditError,
} from "../errors/manual-edit.errors.js";
import { validateSchedule } from "../../domain/rules/engine.js";
import type { ValidateScheduleService } from "../services/validate-schedule.service.js";
import { validateScheduleService } from "../services/validate-schedule.service.js";
import type { OperationalCadastroService } from "../services/operational-cadastro.service.js";
import { operationalCadastroService } from "../services/operational-cadastro.service.js";
import { CalendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { ManualScheduleEditRepository } from "../../infrastructure/repositories/manual-schedule-edit.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { buildContextFromDbParts } from "../../infrastructure/mappers/schedule-context.mapper.js";
import { validationIssuesToDb } from "../../infrastructure/mappers/violation.mapper.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import {
  buildManualEditValidationContext,
  validateManualMove,
  validateManualSet,
} from "../../domain/schedule/manual-edit-validator.js";
import type {
  ManualAllocationType,
  ManualEditCellPayload,
  ManualEditConflict,
  ManualEditMovePayload,
  ManualEditRangePayload,
} from "../../domain/schedule/manual-edit-types.js";
import { iterDateRange } from "../../domain/schedule/manual-edit-types.js";

export interface ManualEditResult {
  success: boolean;
  applied: number;
  conflicts: ManualEditConflict[];
  warnings: string[];
  scheduleMonth: NonNullable<Awaited<ReturnType<ManualScheduleEditRepository["findMonthById"]>>>;
  employees: Awaited<ReturnType<ScheduleRepository["listActiveEmployees"]>>;
  shifts: Awaited<ReturnType<ScheduleRepository["listShifts"]>>;
  assignments: NonNullable<Awaited<ReturnType<ScheduleRepository["findMonth"]>>>["assignments"];
  preAllocations: NonNullable<Awaited<ReturnType<ScheduleRepository["findMonth"]>>>["preAllocations"];
  operationalCadastros: Awaited<
    ReturnType<typeof operationalCadastroService.getOperationalCadastrosForMonth>
  >;
  validation: ReturnType<typeof validateScheduleService.execute>;
}

export class ManualScheduleEditUseCase {
  constructor(
    private readonly editRepo = new ManualScheduleEditRepository(),
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly calendarRepo = new CalendarRepository(),
    private readonly cadastroService: OperationalCadastroService = operationalCadastroService,
    private readonly validator: ValidateScheduleService = validateScheduleService,
  ) {}

  async editCell(scheduleMonthId: string, payload: ManualEditCellPayload): Promise<ManualEditResult> {
    return this.applyToDates(scheduleMonthId, [payload.date], payload);
  }

  async editRange(scheduleMonthId: string, payload: ManualEditRangePayload): Promise<ManualEditResult> {
    const dates = iterDateRange(payload.startDate, payload.endDate);
    return this.applyToDates(scheduleMonthId, dates, payload);
  }

  async moveCell(scheduleMonthId: string, payload: ManualEditMovePayload): Promise<ManualEditResult> {
    const month = await this.loadEditableMonth(scheduleMonthId);
    const vctx = await this.buildValidation(month);
    const conflicts = validateManualMove(vctx, payload.source, payload.target, payload.force);
    this.assertNoBlockingConflicts(conflicts, payload.force);

    const srcOcc = vctx.occupancy.get(`${payload.source.employeeId}|${payload.source.date}`);
    let moveType: ManualAllocationType | null = null;
    if (srcOcc?.shiftCode && ["T6", "T7", "T8"].includes(srcOcc.shiftCode)) {
      moveType = srcOcc.shiftCode as ManualAllocationType;
    } else if (srcOcc?.hasFlight) {
      moveType = "VOO";
    } else if (srcOcc?.preallocLabel) {
      const n = srcOcc.preallocLabel.toUpperCase();
      if (n === "ND") moveType = "ND";
      else if (n.includes("FOLGA PEDIDA")) moveType = "FP";
      else if (n === "FOLGA") moveType = "FOLGA";
      else if (n === "SIMULADOR") moveType = "SIMULADOR";
      else if (n === "CURSO" || n === "CURSO ONLINE") moveType = "CURSO";
      else if (n === "CMA") moveType = "CMA";
      else if (n === "OUTRO") moveType = "OUTRO";
    }

    if (!moveType) {
      throw new ManualEditBlockedError([
        { code: "UNMOVABLE", message: "Conflito: alocação de origem não pode ser movida." },
      ]);
    }

    await this.editRepo.clearDay(scheduleMonthId, payload.source.employeeId, payload.source.date);
    await this.editRepo.applyAllocationType(
      scheduleMonthId,
      payload.target.employeeId,
      payload.target.date,
      moveType,
    );

    return this.buildResult(scheduleMonthId, 1, []);
  }

  private async applyToDates(
    scheduleMonthId: string,
    dates: string[],
    payload: {
      employeeId: string;
      type: ManualAllocationType;
      mode: "set" | "clear";
      force?: boolean;
    },
  ): Promise<ManualEditResult> {
    const month = await this.loadEditableMonth(scheduleMonthId);
    const vctx = await this.buildValidation(month);
    const allConflicts: ManualEditConflict[] = [];

    for (const date of dates) {
      const ref = { employeeId: payload.employeeId, date };
      const type = payload.mode === "clear" ? "CLEAR" : payload.type;
      const conflicts = validateManualSet(vctx, ref, type, payload.force);
      allConflicts.push(...conflicts);
    }

    this.assertNoBlockingConflicts(allConflicts, payload.force);

    let applied = 0;
    for (const date of dates) {
      if (payload.mode === "clear") {
        await this.editRepo.clearDay(scheduleMonthId, payload.employeeId, date, {
          force: payload.force,
        });
      } else {
        await this.editRepo.applyAllocationType(
          scheduleMonthId,
          payload.employeeId,
          date,
          payload.type,
        );
      }
      applied++;
    }

    return this.buildResult(scheduleMonthId, applied, []);
  }

  private assertNoBlockingConflicts(conflicts: ManualEditConflict[], force?: boolean): void {
    const blocking = force
      ? conflicts.filter((c) => !c.requiresConfirmation)
      : conflicts;
    const unique = [...new Map(blocking.map((c) => [c.code + c.message, c])).values()];
    if (unique.length > 0) {
      throw new ManualEditBlockedError(unique);
    }
  }

  private async loadEditableMonth(scheduleMonthId: string) {
    const month = await this.editRepo.findMonthById(scheduleMonthId);
    if (!month) throw new ScheduleMonthNotFoundError(scheduleMonthId);
    if (month.status === "PUBLISHED") throw new SchedulePublishedCannotEditError();
    return month;
  }

  private async buildValidation(month: NonNullable<Awaited<ReturnType<ManualScheduleEditRepository["findMonthById"]>>>) {
    const employees = await this.scheduleRepo.listActiveEmployees();
    const shifts = await this.scheduleRepo.listShifts();
    const shiftRestrictionRows = await this.scheduleRepo.listShiftRestrictionsForMonth(
      month.year,
      month.month,
    );
    const noFlightDates = await this.scheduleRepo.listNoFlightDatesForMonth(month.year, month.month);
    const vacationDays = await this.calendarRepo.listVacationDaysForMonth(month.year, month.month);
    const approvedDayOff = await this.calendarRepo.listApprovedDayOffForMonth(month.year, month.month);
    const flightDays = await this.calendarRepo.listFlightDaysForMonth(month.year, month.month);

    const ctx = buildContextFromDbParts({
      year: month.year,
      month: month.month,
      employees,
      shifts,
      assignments: month.assignments,
      preAllocations: month.preAllocations,
    });

    return buildManualEditValidationContext({
      ctx,
      employees: employees.map((e) => ({ id: e.id, name: e.name, role: e.type })),
      shiftRestrictionRows,
      noFlightDates,
      vacationDays,
      approvedDayOff,
      assignments: month.assignments.map((a) => ({
        employeeId: a.employeeId,
        date: isoDateKey(a.date),
        shiftCode: a.shiftCode,
      })),
      preAllocations: month.preAllocations.map((p) => ({
        employeeId: p.employeeId,
        date: isoDateKey(p.date),
        label: p.label,
      })),
      flightDays,
    });
  }

  private async buildResult(
    scheduleMonthId: string,
    applied: number,
    warnings: string[],
  ): Promise<ManualEditResult> {
    const month = await this.editRepo.findMonthById(scheduleMonthId);
    if (!month) throw new ScheduleMonthNotFoundError(scheduleMonthId);

    const employees = await this.scheduleRepo.listActiveEmployees();
    const shifts = await this.scheduleRepo.listShifts();
    const operationalCadastros = await this.cadastroService.getOperationalCadastrosForMonth(
      month.year,
      month.month,
    );

    const domainContext = buildContextFromDbParts({
      year: month.year,
      month: month.month,
      employees,
      shifts,
      assignments: month.assignments,
      preAllocations: month.preAllocations,
    });
    const engineViolations = validateSchedule(domainContext);
    const validation = this.validator.execute(domainContext);
    const dbViolations = validationIssuesToDb(engineViolations, employees);
    await this.scheduleRepo.saveViolations(scheduleMonthId, dbViolations);

    const monthWithViolations = await this.scheduleRepo.findMonthById(scheduleMonthId);

    return {
      success: true,
      applied,
      conflicts: [],
      warnings,
      scheduleMonth: monthWithViolations ?? month,
      employees,
      shifts,
      assignments: month.assignments,
      preAllocations: month.preAllocations,
      operationalCadastros,
      validation,
    };
  }
}

export const manualScheduleEditUseCase = new ManualScheduleEditUseCase();
