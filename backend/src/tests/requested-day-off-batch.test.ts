import { describe, expect, it } from "vitest";
import { splitBatchDates } from "../application/use-cases/requested-day-off-batch.js";

describe("splitBatchDates", () => {
  const employeeId = "emp-1";

  it("cria múltiplas datas quando não há duplicatas", () => {
    const result = splitBatchDates(
      ["2026-06-01", "2026-06-05", "2026-06-13"],
      employeeId,
      "APPROVED",
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-05", "2026-06-13"]);
    expect(result.skipped).toEqual([]);
  });

  it("ignora duplicadas para mesmo funcionário/data/status", () => {
    const result = splitBatchDates(
      ["2026-06-01", "2026-06-05", "2026-06-13"],
      employeeId,
      "APPROVED",
      [{ employeeId, dateIso: "2026-06-05", status: "APPROVED" }],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-13"]);
    expect(result.skipped).toEqual(["2026-06-05"]);
  });

  it("deduplica datas repetidas no payload", () => {
    const result = splitBatchDates(
      ["2026-06-01", "2026-06-01", "2026-06-02"],
      employeeId,
      "APPROVED",
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.skipped).toEqual([]);
  });

  it("não ignora mesma data com status diferente", () => {
    const result = splitBatchDates(
      ["2026-06-05"],
      employeeId,
      "PENDING",
      [{ employeeId, dateIso: "2026-06-05", status: "APPROVED" }],
    );
    expect(result.toCreate).toEqual(["2026-06-05"]);
    expect(result.skipped).toEqual([]);
  });
});
