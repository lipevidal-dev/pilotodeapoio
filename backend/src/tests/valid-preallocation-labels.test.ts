import { describe, expect, it } from "vitest";
import {
  assertValidPreAllocationLabel,
  InvalidPreAllocationLabelError,
} from "../domain/schedule/valid-preallocation-labels.js";
import { PreAllocationUseCase } from "../application/use-cases/pre-allocation.use-case.js";

describe("valid-preallocation-labels", () => {
  it("aceita SIMULADOR, CURSO, CMA e OUTRO", () => {
    expect(assertValidPreAllocationLabel("SIMULADOR")).toBe("SIMULADOR");
    expect(assertValidPreAllocationLabel("CURSO")).toBe("CURSO");
    expect(assertValidPreAllocationLabel("CMA")).toBe("CMA");
    expect(assertValidPreAllocationLabel("OUTRO")).toBe("OUTRO");
  });

  const rejected = ["VOO", "FÉRIAS", "FP", "FOLGA PEDIDA", "F", "FS", "FA", "FANI", "ND"];

  for (const label of rejected) {
    it(`rejeita label ${label}`, () => {
      expect(() => assertValidPreAllocationLabel(label)).toThrow(InvalidPreAllocationLabelError);
      try {
        assertValidPreAllocationLabel(label);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidPreAllocationLabelError);
        expect((err as InvalidPreAllocationLabelError).code).toBe("INVALID_PREALLOCATION_LABEL");
      }
    });
  }

  it("use-case rejeita VOO com código INVALID_PREALLOCATION_LABEL", async () => {
    const uc = new PreAllocationUseCase();

    await expect(
      uc.create({
        year: 2026,
        month: 6,
        employeeId: "00000000-0000-0000-0000-000000000001",
        date: "2026-06-05",
        label: "VOO",
      }),
    ).rejects.toThrow(InvalidPreAllocationLabelError);
  });
});
