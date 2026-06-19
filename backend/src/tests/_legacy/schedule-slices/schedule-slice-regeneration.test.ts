import { describe, expect, it } from "vitest";
import {
  CLEAR_GENERATED_LABELS,
  MANUAL_PREALLOC_LABELS,
  REGENERATION_CLEAR_LABELS,
  isOperationalHardBlock,
} from "../../domain/schedule/operational-labels.js";
import { generationToScheduleContext } from "../../domain/schedule/generation-context.js";
import { paoUuid, baseGenerationInput } from "./slice-helpers.js";

describe("Fatia 10 — Regeneração", () => {
  it("REGENERATION_CLEAR_LABELS inclui folgas geradas e ND", () => {
    for (const label of ["FOLGA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "ND", "VOO", "FÉRIAS", "FOLGA PEDIDA"]) {
      expect(REGENERATION_CLEAR_LABELS).toContain(label);
    }
  });

  it("MANUAL_PREALLOC_LABELS protege simulador, curso, CMA e OUTRO", () => {
    for (const label of ["SIMULADOR", "CURSO", "CURSO ONLINE", "CMA", "OUTRO"]) {
      expect(MANUAL_PREALLOC_LABELS.has(label)).toBe(true);
    }
  });

  it("labels gerados são hard block mas manuais não entram em REGENERATION_CLEAR", () => {
    expect(REGENERATION_CLEAR_LABELS).not.toContain("SIMULADOR");
    expect(REGENERATION_CLEAR_LABELS).not.toContain("CMA");
    expect(isOperationalHardBlock("SIMULADOR")).toBe(true);
  });

  it("CLEAR_GENERATED_LABELS é subconjunto operacional de limpeza parcial", () => {
    for (const label of CLEAR_GENERATED_LABELS) {
      expect(REGENERATION_CLEAR_LABELS).toContain(label);
    }
  });

  it("FOLGA AGRUPADA gerada é elegível para limpeza na regeneração", () => {
    const ctx = generationToScheduleContext(
      baseGenerationInput(),
      [],
      [{ employeeUuid: paoUuid(1), date: "2026-06-05", label: "FOLGA AGRUPADA" }],
    );
    expect(ctx.allocations.some((a) => a.allocType === "FOLGA AGRUPADA")).toBe(true);
    expect(REGENERATION_CLEAR_LABELS).toContain("FOLGA AGRUPADA");
  });

  it("VOO gerado está em REGENERATION_CLEAR_LABELS", () => {
    expect(REGENERATION_CLEAR_LABELS).toContain("VOO");
  });

  it("bloqueios operacionais manuais não estão na lista de limpeza total", () => {
    for (const label of ["SIMULADOR", "CURSO ONLINE", "CMA", "OUTRO"]) {
      expect(REGENERATION_CLEAR_LABELS.includes(label as (typeof REGENERATION_CLEAR_LABELS)[number])).toBe(false);
    }
  });

  it("FOLGA SOCIAL e FOLGA ANIVERSÁRIO têm política de limpeza distinta", () => {
    expect(REGENERATION_CLEAR_LABELS).toContain("FOLGA SOCIAL");
    expect(REGENERATION_CLEAR_LABELS).toContain("FOLGA ANIVERSÁRIO");
  });
});
