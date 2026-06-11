import { isoDateKey } from "../../domain/rules/date-keys.js";
import { assertValidPreAllocationLabel } from "../../domain/schedule/valid-preallocation-labels.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { executeBatchDelete } from "./batch-delete.js";
import { splitPreAllocBatchDates } from "./pre-allocation-batch.js";

const preAllocRepo = new PreAllocationRepository();
const scheduleRepo = new ScheduleRepository();

export interface PreAllocationBatchResult {
  created: number;
  skipped: number;
  items: Awaited<ReturnType<PreAllocationRepository["create"]>>[];
  skippedDates: string[];
}

export class PreAllocationUseCase {
  list(filters?: {
    scheduleMonthId?: string;
    year?: number;
    month?: number;
    label?: string;
  }) {
    return preAllocRepo.findAll(filters);
  }

  async create(input: {
    year: number;
    month: number;
    employeeId: string;
    date: string;
    label: string;
    notes?: string;
  }) {
    const label = assertValidPreAllocationLabel(input.label);
    const month = await scheduleRepo.ensureMonth(input.year, input.month);
    return preAllocRepo.create({
      scheduleMonthId: month.id,
      employeeId: input.employeeId,
      date: new Date(input.date),
      label,
      notes: input.notes,
    });
  }

  async createBatch(input: {
    year: number;
    month: number;
    employeeId: string;
    dates: string[];
    label: string;
    notes?: string;
    startTime?: string;
    endTime?: string;
  }): Promise<PreAllocationBatchResult> {
    if (input.dates.length === 0) {
      throw new Error("Informe ao menos uma data");
    }

    const label = assertValidPreAllocationLabel(input.label);
    const month = await scheduleRepo.ensureMonth(input.year, input.month);
    const uniqueDates = [...new Set(input.dates)];
    const existingRows = await preAllocRepo.findByScheduleMonthEmployeeDates(
      month.id,
      input.employeeId,
      uniqueDates,
    );
    const existingMapped = existingRows.map((r) => ({
      id: r.id,
      scheduleMonthId: r.scheduleMonthId,
      employeeId: r.employeeId,
      dateIso: isoDateKey(r.date),
      label: r.label,
    }));

    const { toCreate, skipped, legacyIdsToRemove } = splitPreAllocBatchDates(
      uniqueDates,
      month.id,
      input.employeeId,
      label,
      existingMapped,
    );

    if (legacyIdsToRemove.length > 0) {
      await preAllocRepo.deleteMany(legacyIdsToRemove);
    }

    const items = [];
    for (const date of toCreate) {
      const row = await preAllocRepo.create({
        scheduleMonthId: month.id,
        employeeId: input.employeeId,
        date: new Date(`${date}T12:00:00.000Z`),
        label,
        notes: input.notes,
        startTime: input.startTime,
        endTime: input.endTime,
      });
      items.push(row);
    }

    return {
      created: items.length,
      skipped: skipped.length,
      items,
      skippedDates: skipped,
    };
  }

  async update(
    id: string,
    input: {
      date?: string;
      notes?: string | null;
      employeeId?: string;
      startTime?: string | null;
      endTime?: string | null;
    },
    expectedLabel?: string,
  ) {
    const row = await preAllocRepo.findById(id);
    if (!row) {
      throw new Error("Pré-alocação não encontrada");
    }
    if (expectedLabel && row.label.toUpperCase() !== expectedLabel.toUpperCase()) {
      throw new Error("Cadastro operacional não encontrado para este tipo");
    }

    const employeeId = input.employeeId ?? row.employeeId;
    const dateIso = input.date ?? isoDateKey(row.date);
    if (input.date || input.employeeId) {
      const conflicts = await preAllocRepo.findByScheduleMonthEmployeeDates(
        row.scheduleMonthId,
        employeeId,
        [dateIso],
      );
      const duplicate = conflicts.find((c) => c.id !== id && c.label.toUpperCase() === row.label.toUpperCase());
      if (duplicate) {
        throw new Error("Já existe cadastro operacional para este funcionário nesta data");
      }
    }

    return preAllocRepo.update(id, {
      employeeId: input.employeeId,
      date: input.date ? new Date(`${input.date}T12:00:00.000Z`) : undefined,
      notes: input.notes,
      startTime: input.startTime,
      endTime: input.endTime,
    });
  }

  async remove(id: string, expectedLabel?: string) {
    if (expectedLabel) {
      const row = await preAllocRepo.findById(id);
      if (!row) {
        throw new Error("Pré-alocação não encontrada");
      }
      if (row.label.toUpperCase() !== expectedLabel.toUpperCase()) {
        throw new Error("Cadastro operacional não encontrado para este tipo");
      }
    }
    return preAllocRepo.delete(id);
  }

  async removeBatch(ids: string[], expectedLabel?: string) {
    return executeBatchDelete(ids, async (id) => {
      await this.remove(id, expectedLabel);
    });
  }
}

export const preAllocationUseCase = new PreAllocationUseCase();
