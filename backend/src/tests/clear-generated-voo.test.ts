import { describe, expect, it } from "vitest";
import { CLEAR_GENERATED_LABELS } from "../domain/schedule/operational-labels.js";

describe("limpar geração — VOO gerado", () => {
  it("CLEAR_GENERATED_LABELS inclui VOO de preAllocations geradas", () => {
    expect(CLEAR_GENERATED_LABELS).toContain("VOO");
  });
});
