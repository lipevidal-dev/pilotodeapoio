import { describe, expect, it } from "vitest";
import { CLEAR_GENERATED_LABELS } from "../domain/schedule/operational-labels.js";
import { manualTypeToPreallocLabel } from "../domain/schedule/manual-edit-types.js";

describe("limpar geração — VOO gerado", () => {
  it("CLEAR_GENERATED_LABELS inclui VOO de preAllocations geradas", () => {
    expect(CLEAR_GENERATED_LABELS).toContain("VOO");
  });

  it("CLEAR_GENERATED_LABELS inclui folgas automáticas geradas", () => {
    expect(CLEAR_GENERATED_LABELS).toContain("FOLGA");
    expect(CLEAR_GENERATED_LABELS).toContain("FOLGA SOCIAL");
    expect(CLEAR_GENERATED_LABELS).toContain("FOLGA AGRUPADA");
  });

  it("CLEAR_GENERATED_LABELS não inclui folga pedida", () => {
    expect(CLEAR_GENERATED_LABELS).not.toContain("FOLGA PEDIDA");
  });

  it("VOO manual na escala usa preAllocation (removível ao limpar geração)", () => {
    expect(manualTypeToPreallocLabel("VOO")).toBe("VOO");
  });
});
