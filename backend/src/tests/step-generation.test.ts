import { describe, expect, it } from "vitest";
import { StepGenerationEngine } from "../domain/schedule/step-generation-engine.js";
import type { StepGenerationOptions } from "../domain/schedule/step-generation-types.js";
import { minimalPaoInput, realisticGenerationInput } from "./schedule-slices/slice-helpers.js";

const engine = new StepGenerationEngine();

function emptySteps(): StepGenerationOptions {
  return {
    paoCheckPreAllocations: false,
    paoCheckRestrictions: false,
    paoDemandPlanning: false,
    paoCoverageT6: false,
    paoCoverageT7: false,
    paoCoverageT8: false,
    paoAllocateFolgas: false,
    paoAllocateFlights: false,
    apaoCheckPreAllocations: false,
    apaoCheckShiftPreference: false,
    apaoCheckShiftRestrictions: false,
    apaoAllocate: false,
  };
}

function withSteps(partial: Partial<StepGenerationOptions>): StepGenerationOptions {
  return { ...emptySteps(), ...partial };
}

describe("Fase 7.0 — Geração por etapas", () => {
  it("executa somente pré-alocações PAO", () => {
    const input = minimalPaoInput(3);
    const result = engine.execute(input, withSteps({ paoCheckPreAllocations: true }));
    expect(result.mode).toBe("AUDIT_PARTIAL");
    expect(result.persisted).toBe(false);
    expect(result.report.executedSteps).toContain("PAO — Verificar pré-alocações");
    expect(result.assignments.length).toBe(0);
    expect(result.allocations.length).toBeGreaterThanOrEqual(0);
  });

  it("executa somente restrições PAO", () => {
    const result = engine.execute(
      realisticGenerationInput(),
      withSteps({ paoCheckRestrictions: true }),
    );
    expect(result.report.executedSteps).toContain("PAO — Verificar restrições por funcionário");
    expect(result.assignments.length).toBe(0);
  });

  it("executa somente T6", () => {
    const result = engine.execute(
      minimalPaoInput(3),
      withSteps({ paoCoverageT6: true }),
    );
    const codes = new Set(result.assignments.map((a) => a.shiftCode));
    expect(codes.has("T6")).toBe(true);
    expect(codes.has("T7")).toBe(false);
    expect(codes.has("T8")).toBe(false);
    const apao = result.assignments.filter((a) =>
      realisticGenerationInput().employees.some(
        (e) => e.uuid === a.employeeUuid && e.employee.role === "APAO",
      ),
    );
    expect(apao.length).toBe(0);
  });

  it("executa somente T7", () => {
    const result = engine.execute(
      minimalPaoInput(3),
      withSteps({ paoCoverageT7: true }),
    );
    const codes = new Set(result.assignments.map((a) => a.shiftCode));
    expect(codes.has("T7")).toBe(true);
    expect(codes.has("T6")).toBe(false);
  });

  it("T7 only não aloca T6 para PAO com mês inteiro sem voo", () => {
    const input = minimalPaoInput(3);
    const uuid = input.employees[0].uuid;
    input.noFlightDates = Array.from({ length: 30 }, (_, i) => ({
      employeeUuid: uuid,
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    }));
    const result = engine.execute(input, withSteps({ paoCoverageT7: true }));
    expect(result.assignments.some((a) => a.shiftCode === "T6")).toBe(false);
    expect(result.assignments.some((a) => a.shiftCode === "T7")).toBe(true);
  });

  it("executa T6 + T7", () => {
    const result = engine.execute(
      minimalPaoInput(4),
      withSteps({ paoCoverageT6: true, paoCoverageT7: true }),
    );
    const codes = new Set(result.assignments.map((a) => a.shiftCode));
    expect(codes.has("T6")).toBe(true);
    expect(codes.has("T7")).toBe(true);
    expect(codes.has("T8")).toBe(false);
  });

  it("executa somente T8/T8/ND", () => {
    const result = engine.execute(
      minimalPaoInput(4),
      withSteps({ paoCoverageT8: true }),
    );
    const codes = new Set(result.assignments.map((a) => a.shiftCode));
    expect(codes.has("T6")).toBe(false);
    expect(codes.has("T7")).toBe(false);
    expect(codes.has("T8")).toBe(true);
  });

  it("executa PAO completo sem APAO", () => {
    const result = engine.execute(
      realisticGenerationInput(),
      withSteps({
        paoCheckPreAllocations: true,
        paoCoverageT6: true,
        paoCoverageT7: true,
        paoCoverageT8: true,
        paoAllocateFolgas: true,
        paoAllocateFlights: true,
      }),
    );
    expect(result.report.skippedSteps).toContain("APAO — Alocar turnos após cobertura PAO");
    const apaoShifts = ["T1", "T2", "T3", "T4"];
    const apaoAssignments = result.assignments.filter((a) => apaoShifts.includes(a.shiftCode));
    expect(apaoAssignments.length).toBe(0);
  });

  it("APAO sem PAO gera aviso", () => {
    const result = engine.execute(
      realisticGenerationInput(),
      withSteps({ apaoAllocate: true }),
    );
    expect(
      result.report.selectionWarnings.some((w) => w.includes("APAO depende de cobertura PAO")),
    ).toBe(true);
  });

  it("APAO após PAO aloca turnos APAO", () => {
    const result = engine.execute(
      realisticGenerationInput(),
      withSteps({
        paoCheckPreAllocations: true,
        paoCoverageT6: true,
        paoCoverageT7: true,
        apaoAllocate: true,
      }),
    );
    const apaoShifts = ["T1", "T2", "T3", "T4"];
    const apaoAssignments = result.assignments.filter((a) => apaoShifts.includes(a.shiftCode));
    expect(apaoAssignments.length).toBeGreaterThan(0);
  });

  it("voos respeitam não alocar voos", () => {
    const input = realisticGenerationInput();
    const pao = input.employees.find((e) => e.employee.role === "PAO")!;
    const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
    input.noFlightDates = days.map((date) => ({ employeeUuid: pao.uuid, date }));

    const result = engine.execute(
      input,
      withSteps({
        paoCheckPreAllocations: true,
        paoCoverageT6: true,
        paoCoverageT7: true,
        paoAllocateFlights: true,
      }),
    );

    const flightAllocs = result.allocations.filter(
      (a) => a.employeeUuid === pao.uuid && a.label.toUpperCase().includes("VOO"),
    );
    expect(flightAllocs.length).toBe(0);
  });

  it("executa folgas PAO separadamente", () => {
    const result = engine.execute(
      minimalPaoInput(3),
      withSteps({
        paoCheckPreAllocations: true,
        paoCoverageT6: true,
        paoAllocateFolgas: true,
      }),
    );
    expect(result.report.executedSteps).toContain("PAO — Alocar folgas");
    const folgaLabels = result.allocations
      .map((a) => a.label.toUpperCase())
      .filter((l) => l.includes("FOLGA"));
    expect(folgaLabels.length).toBeGreaterThan(0);
  });

  it("etapa não marcada não gera alocação da categoria", () => {
    const result = engine.execute(
      minimalPaoInput(3),
      withSteps({ paoCoverageT6: true }),
    );
    expect(result.assignments.every((a) => a.shiftCode === "T6")).toBe(true);
    expect(result.report.skippedSteps).toContain("PAO — Alocar cobertura T7");
  });

  it("resultado parcial é identificado como auditável", () => {
    const result = engine.execute(
      minimalPaoInput(3),
      withSteps({ paoCoverageT6: true }),
    );
    expect(result.mode).toBe("AUDIT_PARTIAL");
    expect(result.persisted).toBe(false);
    expect(result.report.mode).toBe("AUDIT_PARTIAL");
    expect(result.report.persisted).toBe(false);
  });
});
