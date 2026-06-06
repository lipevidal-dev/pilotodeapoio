import { describe, expect, it } from "vitest";
import { splitPreAllocBatchDates } from "../application/use-cases/pre-allocation-batch.js";

describe("splitPreAllocBatchDates", () => {
  const scheduleMonthId = "month-1";
  const employeeId = "emp-1";
  const label = "SIMULADOR";

  it("cria múltiplas datas quando não há duplicatas", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-01", "2026-06-05", "2026-06-13"],
      scheduleMonthId,
      employeeId,
      label,
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-05", "2026-06-13"]);
    expect(result.skipped).toEqual([]);
    expect(result.legacyIdsToRemove).toEqual([]);
  });

  it("ignora duplicadas para mesmo mês/funcionário/data/label", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-01", "2026-06-05", "2026-06-13"],
      scheduleMonthId,
      employeeId,
      label,
      [
        {
          id: "p1",
          scheduleMonthId,
          employeeId,
          dateIso: "2026-06-05",
          label: "SIMULADOR",
        },
      ],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-13"]);
    expect(result.skipped).toEqual(["2026-06-05"]);
  });

  it("não trata label diferente válido como duplicata do mesmo label", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-05"],
      scheduleMonthId,
      employeeId,
      "SIMULADOR",
      [
        {
          id: "p1",
          scheduleMonthId,
          employeeId,
          dateIso: "2026-06-05",
          label: "CURSO",
        },
      ],
    );
    expect(result.toCreate).toEqual([]);
    expect(result.skipped).toEqual(["2026-06-05"]);
    expect(result.legacyIdsToRemove).toEqual([]);
  });

  it("remove legado inválido (VOO) e permite criar SIMULADOR", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-05", "2026-06-06"],
      scheduleMonthId,
      employeeId,
      "SIMULADOR",
      [
        {
          id: "legacy-voo",
          scheduleMonthId,
          employeeId,
          dateIso: "2026-06-05",
          label: "VOO",
        },
      ],
    );
    expect(result.toCreate).toEqual(["2026-06-05", "2026-06-06"]);
    expect(result.skipped).toEqual([]);
    expect(result.legacyIdsToRemove).toEqual(["legacy-voo"]);
  });

  it("deduplica datas repetidas no payload", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-01", "2026-06-01", "2026-06-02"],
      scheduleMonthId,
      employeeId,
      label,
      [],
    );
    expect(result.toCreate).toEqual(["2026-06-01", "2026-06-02"]);
    expect(result.skipped).toEqual([]);
  });

  it("não ignora mesma data em outro mês de escala", () => {
    const result = splitPreAllocBatchDates(
      ["2026-06-05"],
      scheduleMonthId,
      employeeId,
      label,
      [
        {
          id: "p2",
          scheduleMonthId: "month-2",
          employeeId,
          dateIso: "2026-06-05",
          label: "SIMULADOR",
        },
      ],
    );
    expect(result.toCreate).toEqual(["2026-06-05"]);
    expect(result.skipped).toEqual([]);
  });
});
