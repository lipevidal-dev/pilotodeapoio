import { ScheduleMonthNotFoundError, ScheduleNotPublishedError } from "../errors/schedule.errors.js";
import { operationalCadastroService } from "../services/operational-cadastro.service.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import {
  ExecutedScheduleEditRepository,
  ExecutedScheduleRepository,
} from "../../infrastructure/repositories/executed-schedule.repository.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import type {
  ManualEditMovePayload,
  ManualEditRangePayload,
} from "../../domain/schedule/manual-edit-types.js";
import { iterDateRange } from "../../domain/schedule/manual-edit-types.js";
import { ManualEditBlockedError } from "../errors/manual-edit.errors.js";
import { shiftSwapUseCase } from "./shift-swap.use-case.js";

export class ExecutedScheduleUseCase {
  constructor(
    private readonly executedRepo = new ExecutedScheduleRepository(),
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly cadastroService = operationalCadastroService,
  ) {}

  private mapExecutedMonth(record: NonNullable<Awaited<ReturnType<ExecutedScheduleRepository["findMonth"]>>>) {
    return {
      scheduleMonth: {
        id: record.id,
        year: record.year,
        month: record.month,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
      assignments: record.executedAssignments.map((row) => ({
        id: row.id,
        scheduleMonthId: row.scheduleMonthId,
        employeeId: row.employeeId,
        date: row.date,
        shiftCode: row.shiftCode,
        label: row.label,
        source: row.source,
      })),
      preAllocations: record.executedPreAllocations.map((row) => ({
        id: row.id,
        scheduleMonthId: row.scheduleMonthId,
        employeeId: row.employeeId,
        date: row.date,
        label: row.label,
        notes: row.notes,
        startTime: row.startTime,
        endTime: row.endTime,
      })),
    };
  }

  private async requirePublishedMonth(year: number, month: number) {
    const planned = await this.scheduleRepo.findMonth(year, month);
    if (!planned || planned.status !== "PUBLISHED") {
      throw new ScheduleNotPublishedError(year, month);
    }
    return planned;
  }

  /**
   * Recria o espelho da realizada a partir da planejada publicada.
   * Chamado na publicação — despublicar + alterar + republicar atualiza a realizada.
   */
  async remirrorFromPublished(year: number, month: number): Promise<void> {
    const planned = await this.requirePublishedMonth(year, month);

    let record = await this.executedRepo.findMonth(year, month);
    if (!record) {
      await this.scheduleRepo.ensureMonth(year, month);
      record = await this.executedRepo.findMonth(year, month);
    }
    if (!record) {
      throw new ScheduleMonthNotFoundError(`${year}-${month}`);
    }

    const [employees, cadastros] = await Promise.all([
      this.scheduleRepo.listActiveEmployees(),
      this.cadastroService.getOperationalCadastrosForMonth(year, month),
    ]);
    const employeeTypeById = new Map(employees.map((e) => [e.id, e.type]));
    const cadastroMirrorRows = cadastros.map((row) => ({
      employeeId: row.employeeId,
      date: isoDateKey(row.date),
      label: row.label,
      notes: row.notes ?? null,
    }));

    await this.executedRepo.clearExecutedMonth(record.id);
    await this.executedRepo.syncMissingFromPlanned(
      record.id,
      {
        assignments: planned.assignments ?? [],
        preAllocations: planned.preAllocations ?? [],
      },
      cadastroMirrorRows,
      employeeTypeById,
    );
    await this.executedRepo.repairVacationConflicts(record.id, cadastroMirrorRows);
    // Republicar não pode desfazer trocas que já foram aceitas e aplicadas.
    await shiftSwapUseCase.reapplyApprovedForMonth(year, month);
  }

  private async ensureInitialized(year: number, month: number) {
    const planned = await this.requirePublishedMonth(year, month);

    let record = await this.executedRepo.findMonth(year, month);
    if (!record) {
      await this.scheduleRepo.ensureMonth(year, month);
      record = await this.executedRepo.findMonth(year, month);
    }
    if (!record) {
      throw new ScheduleMonthNotFoundError(`${year}-${month}`);
    }

    const employees = await this.scheduleRepo.listActiveEmployees();
    const employeeTypeById = new Map(employees.map((e) => [e.id, e.type]));

    const existing = await this.executedRepo.countExecutedRows(record.id);
    if (existing === 0) {
      const cadastros = await this.cadastroService.getOperationalCadastrosForMonth(year, month);
      const cadastroMirrorRows = cadastros.map((row) => ({
        employeeId: row.employeeId,
        date: isoDateKey(row.date),
        label: row.label,
        notes: row.notes ?? null,
      }));

      // Espelho inicial único. Depois a realizada é independente e totalmente editável
      // (não re-copia da planejada — senão exclusões como T9 voltam sozinhas).
      await this.executedRepo.syncMissingFromPlanned(
        record.id,
        {
          assignments: planned.assignments ?? [],
          preAllocations: planned.preAllocations ?? [],
        },
        cadastroMirrorRows,
        employeeTypeById,
      );
      await this.executedRepo.repairVacationConflicts(record.id, cadastroMirrorRows);
    } else {
      // Só limpa labels que não deveriam estar no PAO; não reintroduz turnos/folgas.
      await this.executedRepo.purgeExcludedPreAllocations(record.id, employeeTypeById);
    }

    return this.executedRepo.findMonth(year, month);
  }

  async getMonth(year: number, month: number) {
    const record = await this.ensureInitialized(year, month);
    if (!record) {
      throw new ScheduleMonthNotFoundError(`${year}-${month}`);
    }

    const [shifts, employees, shiftSwaps] = await Promise.all([
      this.scheduleRepo.listShifts(),
      this.scheduleRepo.listActiveEmployees(),
      shiftSwapUseCase.listVisualForMonth(year, month),
    ]);
    const mapped = this.mapExecutedMonth(record);

    return {
      ...mapped,
      employees,
      shifts,
      operationalCadastros: [],
      shiftSwaps,
      ruleViolations: [],
      validation: null,
      initializedFromPlanned: true,
    };
  }

  async getPortalMonthForEmployee(employeeId: string, year: number, month: number) {
    const planned = await this.requirePublishedMonth(year, month);
    const data = await this.getMonth(year, month);
    // Portal: só trocas em que o colaborador participa (admin vê todas via getMonth).
    const shiftSwaps = (data.shiftSwaps ?? []).filter(
      (s) => s.requesterEmployeeId === employeeId || s.targetEmployeeId === employeeId,
    );
    return { ...data, shiftSwaps, isPublished: planned.status === "PUBLISHED" };
  }
}

export class ExecutedScheduleEditUseCase {
  constructor(
    private readonly editRepo = new ExecutedScheduleEditRepository(),
    private readonly executedUseCase = new ExecutedScheduleUseCase(),
    private readonly scheduleRepo = new ScheduleRepository(),
  ) {}

  private async requirePublishedByMonthId(scheduleMonthId: string) {
    const month = await this.editRepo.findMonthById(scheduleMonthId);
    if (!month) {
      throw new ScheduleMonthNotFoundError(scheduleMonthId);
    }
    const planned = await this.scheduleRepo.findMonth(month.year, month.month);
    if (!planned || planned.status !== "PUBLISHED") {
      throw new ScheduleNotPublishedError(month.year, month.month);
    }
    return month;
  }

  async editRange(scheduleMonthId: string, payload: ManualEditRangePayload) {
    const month = await this.requirePublishedByMonthId(scheduleMonthId);

    const dates = iterDateRange(payload.startDate, payload.endDate);
    for (const date of dates) {
      await this.editRepo.applyAllocationType(
        scheduleMonthId,
        payload.employeeId,
        date,
        payload.type,
      );
    }

    return this.executedUseCase.getMonth(month.year, month.month);
  }

  async moveCell(scheduleMonthId: string, payload: ManualEditMovePayload) {
    const month = await this.requirePublishedByMonthId(scheduleMonthId);

    const moveType = await this.editRepo.readDayType(
      scheduleMonthId,
      payload.source.employeeId,
      payload.source.date,
    );
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

    return this.executedUseCase.getMonth(month.year, month.month);
  }
}

export const executedScheduleUseCase = new ExecutedScheduleUseCase();
export const executedScheduleEditUseCase = new ExecutedScheduleEditUseCase();
