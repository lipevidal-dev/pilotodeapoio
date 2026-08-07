import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import {
  ScheduleCannotUnpublishError,
  ScheduleMonthNotFoundError,
} from "../errors/schedule.errors.js";

export interface UnpublishScheduleResult {
  scheduleMonthId: string;
  year: number;
  month: number;
  status: "GENERATED";
}

export class UnpublishScheduleUseCase {
  constructor(private readonly scheduleRepo = new ScheduleRepository()) {}

  async execute(scheduleMonthId: string): Promise<UnpublishScheduleResult> {
    const record = await this.scheduleRepo.findMonthById(scheduleMonthId);
    if (!record) {
      throw new ScheduleMonthNotFoundError(scheduleMonthId);
    }

    if (record.status !== "PUBLISHED") {
      throw new ScheduleCannotUnpublishError(
        `Somente escalas publicadas podem ser despublicadas (atual: ${record.status}).`,
      );
    }

    const unpublished = await this.scheduleRepo.unpublishMonth(record.id);
    return {
      scheduleMonthId: unpublished.id,
      year: unpublished.year,
      month: unpublished.month,
      status: "GENERATED",
    };
  }
}

export const unpublishScheduleUseCase = new UnpublishScheduleUseCase();
