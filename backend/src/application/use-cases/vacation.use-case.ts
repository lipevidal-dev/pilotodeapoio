import { isoDateKey } from "../../domain/rules/date-keys.js";
import { vacationToApi } from "../../infrastructure/mappers/vacation-api.mapper.js";
import { VacationRepository } from "../../infrastructure/repositories/vacation.repository.js";
import { executeBatchDelete } from "./batch-delete.js";
import { splitVacationBatchPeriods } from "./vacation-batch.js";
import type { VacationApiRecord } from "../../infrastructure/mappers/vacation-api.mapper.js";

export interface VacationBatchResult {
  created: number;
  skipped: number;
  items: VacationApiRecord[];
  skippedPeriods: { startDate: string; endDate: string }[];
}

export class VacationUseCase {
  constructor(private readonly repo = new VacationRepository()) {}

  async list() {
    const rows = await this.repo.findAll();
    return rows.map(vacationToApi);
  }

  async create(input: { employeeId: string; startDate: string; endDate: string; notes?: string }) {
    if (input.startDate > input.endDate) {
      throw new Error("Data início deve ser anterior ou igual à data fim");
    }
    const row = await this.repo.create(input);
    return vacationToApi(row);
  }
  async createBatch(input: {
    employeeId: string;
    periods: { startDate: string; endDate: string }[];
    notes?: string;
  }): Promise<VacationBatchResult> {
    if (input.periods.length === 0) {
      throw new Error("Informe ao menos um período");
    }

    for (const p of input.periods) {
      if (p.startDate > p.endDate) {
        throw new Error("Data início deve ser anterior ou igual à data fim");
      }
    }

    const existingRows = await this.repo.findByEmployee(input.employeeId);
    const existingKeys = existingRows.map((r) => ({
      employeeId: r.employeeId,
      startDateIso: isoDateKey(r.startDate),
      endDateIso: isoDateKey(r.endDate),
    }));
    const { toCreate, skipped } = splitVacationBatchPeriods(
      input.periods,
      input.employeeId,
      existingKeys,
    );

    const items = [];
    for (const period of toCreate) {
      const row = await this.repo.create({
        employeeId: input.employeeId,
        startDate: period.startDate,
        endDate: period.endDate,
        notes: input.notes,
      });
      items.push(vacationToApi(row));
    }

    return {
      created: items.length,
      skipped: skipped.length,
      items,      skippedPeriods: skipped,
    };
  }

  async update(
    id: string,
    input: {
      employeeId?: string;
      startDate?: string;
      endDate?: string;
      notes?: string | null;
    },
  ) {
    const row = await this.repo.findById(id);
    if (!row) throw new Error("Férias não encontradas");

    const startDate = input.startDate ?? isoDateKey(row.startDate);
    const endDate = input.endDate ?? isoDateKey(row.endDate);
    if (startDate > endDate) {
      throw new Error("Data início deve ser anterior ou igual à data fim");
    }

    const employeeId = input.employeeId ?? row.employeeId;
    const existing = await this.repo.findByEmployee(employeeId);
    const duplicate = existing.find(
      (r) =>
        r.id !== id &&
        isoDateKey(r.startDate) === startDate &&
        isoDateKey(r.endDate) === endDate,
    );
    if (duplicate) {
      throw new Error("Já existe férias com o mesmo período para este funcionário");
    }

    const updated = await this.repo.update(id, {
      employeeId: input.employeeId,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes,
    });
    return vacationToApi(updated);
  }

  async remove(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new Error("Férias não encontradas");
    return this.repo.delete(id);
  }

  async removeBatch(ids: string[]) {
    return executeBatchDelete(ids, async (id) => {
      await this.remove(id);
    });
  }
}

export const vacationUseCase = new VacationUseCase();
