import { describe, expect, it } from "vitest";
import { CLEAR_GENERATED_LABELS } from "../domain/schedule/operational-labels.js";
import { manualTypeToPreallocLabel } from "../domain/schedule/manual-edit-types.js";

describe("limpar geração — VOO gerado", () => {
  it("CLEAR_GENERATED_LABELS inclui VOO de preAllocations geradas", () => {
    expect(CLEAR_GENERATED_LABELS).toContain("VOO");
  });

  it("CLEAR_GENERATED_LABELS inclui folgas agrupadas e aniversário geradas", () => {
    expect(CLEAR_GENERATED_LABELS).toContain("FOLGA AGRUPADA");
    expect(CLEAR_GENERATED_LABELS).toContain("FOLGA ANIVERSÁRIO");
  });

  it("VOO manual na escala usa preAllocation (removível ao limpar geração)", () => {
    expect(manualTypeToPreallocLabel("VOO")).toBe("VOO");
  });

  it("limpar geração inclui preAllocation marcada escala-manual", () => {
    expect(CLEAR_GENERATED_LABELS).toContain("VOO");
    expect(CLEAR_GENERATED_LABELS).toContain("FOLGA");
  });
});
