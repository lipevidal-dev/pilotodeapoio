import { describe, expect, it } from "vitest";
import { splitPreAllocBatchDates } from "../application/use-cases/pre-allocation-batch.js";

describe("labeled pre-allocation batch", () => {
  const scheduleMonthId = "month-1";
  const employeeId = "emp-1";

  it("cria SIMULADOR em 2 datas novas", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-01", "2026-06-02"],
      scheduleMonthId,
      employeeId,
      "SIMULADOR",
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.skipped).toEqual([]);
  });

  it("cria CURSO em 2 datas novas", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-03", "2026-06-04"],
      scheduleMonthId,
      employeeId,
      "CURSO",
      [],
    );
    expect(result.toCreate).toHaveLength(2);
  });

  it("cria CMA em 2 datas novas", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-05", "2026-06-06"],
      scheduleMonthId,
      employeeId,
      "CMA",
      [],
    );
    expect(result.toCreate).toHaveLength(2);
  });

  it("cria OUTRO em 2 datas novas", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-07", "2026-06-08"],
      scheduleMonthId,
      employeeId,
      "OUTRO",
      [],
    );
    expect(result.toCreate).toHaveLength(2);
  });

  it("duplicidade só com mesmo employeeId + date + label", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-01"],
      scheduleMonthId,
      employeeId,
      "SIMULADOR",
      [
        {
          id: "p1",
          scheduleMonthId,
          employeeId,
          dateIso: "2026-06-01",
          label: "SIMULADOR",
        },
      ],
    );
    expect(result.toCreate).toEqual([]);
    expect(result.skipped).toEqual(["2026-06-01"]);
  });

  it("registro legado VOO não bloqueia novo SIMULADOR", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-01"],
      scheduleMonthId,
      employeeId,
      "SIMULADOR",
      [
        {
          id: "legacy",
          scheduleMonthId,
          employeeId,
          dateIso: "2026-06-01",
          label: "VOO",
        },
      ],
    );
    expect(result.toCreate).toEqual(["2026-06-01"]);
    expect(result.legacyIdsToRemove).toEqual(["legacy"]);
  });
});
