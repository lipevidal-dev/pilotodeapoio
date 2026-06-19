import { describe, expect, it } from "vitest";
import {
  isPreAllocationRemovedOnClear,
  MANUAL_OPERATIONAL_PRESERVE_LABELS,
  MOTOR_GENERATED_PREALLOC_LABELS,
} from "../domain/schedule/clear-generated-policy.js";
import { CLEAR_GENERATED_LABELS } from "../domain/schedule/operational-labels.js";

describe("limpar escala — preservar cadastros manuais", () => {
  it("remove apenas labels gerados pelo motor", () => {
    for (const label of MOTOR_GENERATED_PREALLOC_LABELS) {
      expect(isPreAllocationRemovedOnClear(label)).toBe(true);
    }
  });

  it("preserva FP do APAO e do PAO", () => {
    expect(isPreAllocationRemovedOnClear("FOLGA PEDIDA")).toBe(false);
    expect(isPreAllocationRemovedOnClear("FP")).toBe(false);
  });

  it("preserva férias, FANI, simulador, curso, CMA e OUTRO", () => {
    for (const label of MANUAL_OPERATIONAL_PRESERVE_LABELS) {
      expect(isPreAllocationRemovedOnClear(label)).toBe(false);
    }
  });

  it("CLEAR_GENERATED_LABELS não inclui FOLGA PEDIDA nem FOLGA ANIVERSÁRIO", () => {
    expect(CLEAR_GENERATED_LABELS).not.toContain("FOLGA PEDIDA");
    expect(CLEAR_GENERATED_LABELS).not.toContain("FOLGA ANIVERSÁRIO");
    expect(CLEAR_GENERATED_LABELS).not.toContain("FÉRIAS");
  });

  it("FOLGA ANIVERSÁRIO manual não é removida ao limpar", () => {
    expect(isPreAllocationRemovedOnClear("FOLGA ANIVERSÁRIO")).toBe(false);
    expect(isPreAllocationRemovedOnClear("FANI")).toBe(false);
  });
});
