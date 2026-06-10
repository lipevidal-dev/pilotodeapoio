import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import {
  PublishedScheduleCannotBeClearedError,
  ScheduleMonthNotFoundError,
  ScheduleNotGeneratedError,
} from "../errors/schedule.errors.js";

export interface ClearGeneratedScheduleResult {
  scheduleMonthId: string;
  year: number;
  month: number;
  status: "GENERATED" | "DRAFT";
}

export class ClearGeneratedScheduleUseCase {
  constructor(private readonly scheduleRepo = new ScheduleRepository()) {}

  async execute(scheduleMonthId: string): Promise<ClearGeneratedScheduleResult> {
    const record = await this.scheduleRepo.findMonthById(scheduleMonthId);
    if (!record) {
      throw new ScheduleMonthNotFoundError(scheduleMonthId);
    }

    if (record.status === "PUBLISHED") {
      throw new PublishedScheduleCannotBeClearedError();
    }

    if (record.status !== "GENERATED" && record.status !== "DRAFT") {
      throw new ScheduleNotGeneratedError(record.status);
    }

    const updated = await this.scheduleRepo.clearGeneratedData(scheduleMonthId);
    return {
      scheduleMonthId: updated.id,
      year: updated.year,
      month: updated.month,
      status: updated.status as "GENERATED",
    };
  }
}

export const clearGeneratedScheduleUseCase = new ClearGeneratedScheduleUseCase();
