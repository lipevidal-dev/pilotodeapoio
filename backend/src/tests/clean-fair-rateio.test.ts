import { describe, expect, it } from "vitest";
import {
  calculateCoverageDemand,
  fairRateioRemainderGaps,
  fairRateioTargetPerEmployee,
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
