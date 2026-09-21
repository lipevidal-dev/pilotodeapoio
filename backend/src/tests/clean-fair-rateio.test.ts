import { describe, expect, it } from "vitest";
import {
  calculateCoverageDemand,
  fairRateioExpectedForEmployee,
  fairRateioExpectedYearToDate,
  fairRateioRemainderGaps,
  fairRateioTargetPerEmployee,
  buildYearRateioExpectedContext,
  buildFairRateioReport,
} from "../domain/schedule/clean-engine/clean-fair-rateio.js";
import {
  MIN_RATEIO_BLOCK_SIZE,
  requiredBlockSizeForShift,
} from "../domain/schedule/clean-engine/clean-block-rules.js";

describe("fair rateio — floor(demanda/colaboradores)", () => {
  it("31 dias × T6/T7/T8 = 93; 12 PAOs → meta 7 e 9 gaps", () => {
    const codes = ["T6", "T7", "T8"];
    expect(calculateCoverageDemand(31, codes)).toBe(93);
    expect(fairRateioTargetPerEmployee(31, codes, 12)).toBe(7);
    expect(fairRateioRemainderGaps(31, codes, 12)).toBe(9);
    expect(7 * 12 + 9).toBe(93);
  });

  it("30 dias × 3 = 90; 12 PAOs → meta 7 e 6 gaps", () => {
    const codes = ["T6", "T7", "T8"];
    expect(fairRateioTargetPerEmployee(30, codes, 12)).toBe(7);
    expect(fairRateioRemainderGaps(30, codes, 12)).toBe(6);
  });

  it("divisão exata não deixa resto", () => {
    expect(fairRateioTargetPerEmployee(30, ["T6", "T7", "T8"], 10)).toBe(9);
    expect(fairRateioRemainderGaps(30, ["T6", "T7", "T8"], 10)).toBe(0);
  });

  it("N(m) oscila: mês com 10 e mês com 14 mudam a meta", () => {
    const codes = ["T6", "T7", "T8"];
    // 30d → demanda 90
    expect(fairRateioTargetPerEmployee(30, codes, 10)).toBe(9);
    expect(fairRateioTargetPerEmployee(30, codes, 14)).toBe(6);
    expect(fairRateioTargetPerEmployee(30, codes, 12)).toBe(7);
  });
});

describe("fair rateio — expected YTD com N(m) oscilante", () => {
  const codes = ["T6", "T7", "T8"];

  it("N fixo (legado) ainda soma meta igual em todos os meses", () => {
    const ytd = fairRateioExpectedYearToDate(2026, 3, codes, 12);
    expect(ytd).toBe(
      fairRateioTargetPerEmployee(31, codes, 12) +
        fairRateioTargetPerEmployee(28, codes, 12) +
        fairRateioTargetPerEmployee(31, codes, 12),
    );
  });

  it("Map N(m): 10 / 12 / 14 → metas distintas", () => {
    const byMonth = new Map([
      [1, 10],
      [2, 12],
      [3, 14],
    ]);
    const ytd = fairRateioExpectedYearToDate(2026, 3, codes, byMonth);
    expect(ytd).toBe(
      fairRateioTargetPerEmployee(31, codes, 10) +
        fairRateioTargetPerEmployee(28, codes, 12) +
        fairRateioTargetPerEmployee(31, codes, 14),
    );
    expect(ytd).not.toBe(fairRateioExpectedYearToDate(2026, 3, codes, 12));
  });

  it("admissão no meio do ano: expected só nos meses ativos", () => {
    const byMonth = new Map([
      [1, 12],
      [2, 12],
      [3, 11],
      [4, 11],
    ]);
    const active = new Set([3, 4]);
    const expected = fairRateioExpectedForEmployee(2026, 4, codes, byMonth, active);
    expect(expected).toBe(
      fairRateioTargetPerEmployee(31, codes, 11) + fairRateioTargetPerEmployee(30, codes, 11),
    );
    expect(expected).toBeLessThan(fairRateioExpectedYearToDate(2026, 4, codes, byMonth));
  });

  it("buildYearRateioExpectedContext junta histórico + mês corrente", () => {
    const ctx = buildYearRateioExpectedContext({
      year: 2026,
      currentMonth: 4,
      currentEmployeeCount: 13,
      currentEmployeeUuids: ["a", "b", "c"],
      priorMonths: [
        { month: 1, employeeCount: 10, employeeUuids: ["a", "b"] },
        { month: 2, employeeCount: 12, employeeUuids: ["a", "b", "x"] },
        { month: 3, employeeCount: 11, employeeUuids: ["a", "c"] },
      ],
    });
    expect(ctx.employeeCountByMonth.get(1)).toBe(10);
    expect(ctx.employeeCountByMonth.get(4)).toBe(13);
    expect(ctx.activeMonthsByUuid.get("a")).toEqual(new Set([1, 2, 3, 4]));
    expect(ctx.activeMonthsByUuid.get("c")).toEqual(new Set([3, 4]));
    expect(ctx.activeMonthsByUuid.get("x")).toEqual(new Set([2]));
  });

  it("buildFairRateioReport ordena por saldo (mais negativo primeiro)", () => {
    const report = buildFairRateioReport({
      year: 2026,
      month: 11,
      daysInMonth: 30,
      coverageShiftCodes: codes,
      employeeCount: 12,
      employeeCountByMonth: new Map([[11, 12]]),
      employees: [
        {
          uuid: "b",
          name: "B",
          prior: 70,
          monthCount: 7,
          expected: 70,
          activeMonths: [11],
        },
        {
          uuid: "a",
          name: "A",
          prior: 40,
          monthCount: 7,
          expected: 70,
          activeMonths: [11],
        },
      ],
    });
    expect(report.meta).toBe(7);
    expect(report.employeeCount).toBe(12);
    expect(report.employees[0]!.name).toBe("A");
    expect(report.employees[0]!.saldo).toBeLessThan(report.employees[1]!.saldo);
  });
});

describe("requiredBlockSizeForShift — agrupamento", () => {
  it("T6/T7 usam agrupamento configurado (5), não o piso 3", () => {
    expect(requiredBlockSizeForShift("T6", 5)).toBe(5);
    expect(requiredBlockSizeForShift("T7", 5)).toBe(5);
    expect(requiredBlockSizeForShift("T6", 2)).toBe(MIN_RATEIO_BLOCK_SIZE);
  });

  it("T8/T9 permanecem unitários", () => {
    expect(requiredBlockSizeForShift("T8", 5)).toBe(1);
    expect(requiredBlockSizeForShift("T9", 5)).toBe(1);
  });
});
