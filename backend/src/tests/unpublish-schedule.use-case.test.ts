import { describe, expect, it, vi } from "vitest";
import { UnpublishScheduleUseCase } from "../application/use-cases/unpublish-schedule.use-case.js";
import {
  ScheduleCannotUnpublishError,
  ScheduleMonthNotFoundError,
} from "../application/errors/schedule.errors.js";

describe("UnpublishScheduleUseCase", () => {
  it("despublica escala PUBLISHED para GENERATED", async () => {
    const repo = {
      findMonthById: vi.fn().mockResolvedValue({
        id: "sm-1",
        year: 2026,
        month: 8,
        status: "PUBLISHED",
      }),
      unpublishMonth: vi.fn().mockResolvedValue({
        id: "sm-1",
        year: 2026,
        month: 8,
        status: "GENERATED",
      }),
    };

    const uc = new UnpublishScheduleUseCase(repo as never);
    const result = await uc.execute("sm-1");

    expect(result).toEqual({
      scheduleMonthId: "sm-1",
      year: 2026,
      month: 8,
      status: "GENERATED",
    });
    expect(repo.unpublishMonth).toHaveBeenCalledWith("sm-1");
  });

  it("rejeita quando a escala não está publicada", async () => {
    const repo = {
      findMonthById: vi.fn().mockResolvedValue({
        id: "sm-1",
        year: 2026,
        month: 8,
        status: "GENERATED",
      }),
      unpublishMonth: vi.fn(),
    };

    const uc = new UnpublishScheduleUseCase(repo as never);
    await expect(uc.execute("sm-1")).rejects.toBeInstanceOf(ScheduleCannotUnpublishError);
    expect(repo.unpublishMonth).not.toHaveBeenCalled();
  });

  it("rejeita quando a escala não existe", async () => {
    const repo = {
      findMonthById: vi.fn().mockResolvedValue(null),
      unpublishMonth: vi.fn(),
    };

    const uc = new UnpublishScheduleUseCase(repo as never);
    await expect(uc.execute("missing")).rejects.toBeInstanceOf(ScheduleMonthNotFoundError);
  });
});
