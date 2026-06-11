import { isoDateKey } from "../../domain/rules/date-keys.js";
import { FlightAssignmentRepository } from "../../infrastructure/repositories/flight-assignment.repository.js";
import { executeBatchDelete } from "./batch-delete.js";
import { splitFlightBatchDates } from "./flight-assignment-batch.js";

const repo = new FlightAssignmentRepository();

export interface FlightAssignmentBatchResult {
  created: number;
  skipped: number;
  items: Awaited<ReturnType<FlightAssignmentRepository["create"]>>[];
  skippedDates: string[];
}

export class FlightAssignmentUseCase {
  list() {
    return repo.findAll();
  }

  async create(input: {
    employeeId: string;
    date: string;
    description?: string;
    source?: "MANUAL" | "GENERATOR" | "IMPORT" | "REPAIR";
  }) {
    try {
      return await repo.create(input);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        throw new Error("Já existe voo para este funcionário nesta data");
      }
      throw err;
    }
  }

  async createBatch(input: {
    employeeId: string;
    dates: string[];
    description?: string;
    source?: "MANUAL" | "GENERATOR" | "IMPORT" | "REPAIR";
  }): Promise<FlightAssignmentBatchResult> {
    if (input.dates.length === 0) {
      throw new Error("Informe ao menos uma data");
    }

    const uniqueDates = [...new Set(input.dates)];
    const existingRows = await repo.findByEmployeeDates(input.employeeId, uniqueDates);
    const existingKeys = existingRows.map((r) => ({
      employeeId: r.employeeId,
      dateIso: isoDateKey(r.date),
    }));

    const { toCreate, skipped } = splitFlightBatchDates(
      uniqueDates,
      input.employeeId,
      existingKeys,
    );

    const items = [];
    for (const date of toCreate) {
      const row = await repo.create({
        employeeId: input.employeeId,
        date,
        description: input.description,
        source: input.source,
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
      description?: string | null;
    },
  ) {
    const row = await repo.findById(id);
    if (!row) throw new Error("Voo não encontrado");

    const employeeId = input.employeeId ?? row.employeeId;
    const date = input.date ?? isoDateKey(row.date);

    if (input.date || input.employeeId) {
      const existing = await repo.findByEmployeeDates(employeeId, [date]);
      const duplicate = existing.find((r) => r.id !== id);
      if (duplicate) {
        throw new Error("Já existe voo para este funcionário nesta data");
      }
    }

    try {
      return await repo.update(id, {
        employeeId: input.employeeId,
        date: input.date,
        description: input.description,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        throw new Error("Já existe voo para este funcionário nesta data");
      }
      throw err;
    }
  }

  async remove(id: string) {
    const row = await repo.findById(id);
    if (!row) throw new Error("Voo não encontrado");
    return repo.delete(id);
  }

  async removeBatch(ids: string[]) {
    return executeBatchDelete(ids, async (id) => {
      await this.remove(id);
    });
  }
}

export const flightAssignmentUseCase = new FlightAssignmentUseCase();
