import { describe, expect, it } from "vitest";
import { splitVacationBatchPeriods } from "../application/use-cases/vacation-batch.js";

describe("splitVacationBatchPeriods", () => {
  const employeeId = "emp-1";

  it("cria múltiplos períodos quando não há duplicatas", () => {
    const periods = [
      { startDate: "2026-06-01", endDate: "2026-06-10" },
      { startDate: "2026-06-20", endDate: "2026-06-25" },
    ];
    const result = splitVacationBatchPeriods(periods, employeeId, []);
    expect(result.toCreate).toEqual(periods);
    expect(result.skipped).toEqual([]);
  });

  it("ignora período duplicado exato", () => {
    const periods = [
      { startDate: "2026-06-01", endDate: "2026-06-10" },
      { startDate: "2026-06-20", endDate: "2026-06-25" },
    ];
    const result = splitVacationBatchPeriods(periods, employeeId, [
      { employeeId, startDateIso: "2026-06-01", endDateIso: "2026-06-10" },
    ]);
    expect(result.toCreate).toEqual([{ startDate: "2026-06-20", endDate: "2026-06-25" }]);
    expect(result.skipped).toEqual([{ startDate: "2026-06-01", endDate: "2026-06-10" }]);
  });

  it("deduplica períodos repetidos no payload", () => {
    const periods = [
      { startDate: "2026-06-01", endDate: "2026-06-10" },
      { startDate: "2026-06-01", endDate: "2026-06-10" },
    ];
    const result = splitVacationBatchPeriods(periods, employeeId, []);
    expect(result.toCreate).toEqual([{ startDate: "2026-06-01", endDate: "2026-06-10" }]);
    expect(result.skipped).toEqual([]);
  });

  it("não ignora período de outro funcionário", () => {
    const periods = [{ startDate: "2026-06-01", endDate: "2026-06-10" }];
    const result = splitVacationBatchPeriods(periods, employeeId, [
      { employeeId: "emp-2", startDateIso: "2026-06-01", endDateIso: "2026-06-10" },
    ]);
    expect(result.toCreate).toEqual(periods);
    expect(result.skipped).toEqual([]);
  });
});
