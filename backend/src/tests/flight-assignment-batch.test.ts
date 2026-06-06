import { describe, expect, it } from "vitest";
import { splitFlightBatchDates } from "../application/use-cases/flight-assignment-batch.js";

describe("splitFlightBatchDates", () => {
  const employeeId = "emp-1";

  it("cria múltiplas datas quando não há duplicatas", () => {
    const result = splitFlightBatchDates(
      ["2026-06-01", "2026-06-05", "2026-06-13"],
      employeeId,
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-05", "2026-06-13"]);
    expect(result.skipped).toEqual([]);
  });

  it("ignora duplicadas para mesmo funcionário/data", () => {
    const result = splitFlightBatchDates(
      ["2026-06-01", "2026-06-05", "2026-06-13"],
      employeeId,
      [{ employeeId, dateIso: "2026-06-05" }],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-13"]);
    expect(result.skipped).toEqual(["2026-06-05"]);
  });

  it("deduplica datas repetidas no payload", () => {
    const result = splitFlightBatchDates(
      ["2026-06-01", "2026-06-01", "2026-06-02"],
      employeeId,
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.skipped).toEqual([]);
  });

  it("não ignora mesma data de outro funcionário", () => {
    const result = splitFlightBatchDates(
      ["2026-06-05"],
      employeeId,
      [{ employeeId: "emp-2", dateIso: "2026-06-05" }],
    );
    expect(result.toCreate).toEqual(["2026-06-05"]);
    expect(result.skipped).toEqual([]);
  });
});
