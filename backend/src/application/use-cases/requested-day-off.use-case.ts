import { isoDateKey } from "../../domain/rules/date-keys.js";
import { RequestedDayOffRepository } from "../../infrastructure/repositories/requested-day-off.repository.js";
import { executeBatchDelete } from "./batch-delete.js";
import { splitBatchDates } from "./requested-day-off-batch.js";

const repo = new RequestedDayOffRepository();

export interface RequestedDayOffBatchResult {
  created: number;
  skipped: number;
  items: Awaited<ReturnType<RequestedDayOffRepository["create"]>>[];
  skippedDates: string[];
}

export class RequestedDayOffUseCase {
  list() {
    return repo.findAll();
  }

  create(input: {
    employeeId: string;
    date: string;
    status?: "PENDING" | "APPROVED" | "REJECTED";
    notes?: string;
  }) {
    return repo.create(input);
  }

  async createBatch(input: {
    employeeId: string;
    dates: string[];
    status: "PENDING" | "APPROVED" | "REJECTED";
    notes?: string;
  }): Promise<RequestedDayOffBatchResult> {
    if (input.dates.length === 0) {
      throw new Error("Informe ao menos uma data");
    }

    const status = input.status;
    const uniqueDates = [...new Set(input.dates)];
    const existingRows = await repo.findByEmployeeDatesStatus(
      input.employeeId,
      uniqueDates,
      status,
    );

    const existingKeys = existingRows.map((r) => ({
      employeeId: r.employeeId,
      dateIso: isoDateKey(r.date),
      status: r.status,
    }));

    const { toCreate, skipped } = splitBatchDates(
      uniqueDates,
      input.employeeId,
      status,
      existingKeys,
    );

    const items = [];
    for (const date of toCreate) {
      const row = await repo.create({
        employeeId: input.employeeId,
        date,
        status,
        notes: input.notes,
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
      employeeId?: string;
      date?: string;
      status?: "PENDING" | "APPROVED" | "REJECTED";
      notes?: string | null;
    },
  ) {
    const row = await repo.findById(id);
    if (!row) throw new Error("Folga pedida não encontrada");

    const employeeId = input.employeeId ?? row.employeeId;
    const date = input.date ?? isoDateKey(row.date);
    const status = input.status ?? row.status;

    if (input.date || input.employeeId || input.status) {
      const existing = await repo.findByEmployeeDatesStatus(employeeId, [date], status);
      const duplicate = existing.find((r) => r.id !== id);
      if (duplicate) {
        throw new Error("Já existe folga pedida para este funcionário nesta data");
      }
    }

    return repo.update(id, {
      employeeId: input.employeeId,
      date: input.date,
      status: input.status,
      notes: input.notes,
    });
  }

  async remove(id: string) {
    const row = await repo.findById(id);
    if (!row) throw new Error("Folga pedida não encontrada");
    return repo.delete(id);
  }

  async removeBatch(ids: string[]) {
    return executeBatchDelete(ids, async (id) => {
      await this.remove(id);
    });
  }
}

export const requestedDayOffUseCase = new RequestedDayOffUseCase();
