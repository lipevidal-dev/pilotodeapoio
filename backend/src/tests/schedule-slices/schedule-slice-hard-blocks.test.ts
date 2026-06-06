import { describe, expect, it } from "vitest";
import { isOperationalHardBlock } from "../../domain/schedule/operational-labels.js";
import {
  allocationLabels,
  freshWorkspace,
  hasAssignment,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  realPaoUuid,
} from "./slice-helpers.js";

describe("Fatia 2 — Hard Blocks", () => {
  const day = "2026-06-15";

  it("férias bloqueiam turno e gravam FÉRIAS", () => {
    const input = minimalPaoInput(2);
    input.vacationDays = [{ employeeUuid: paoUuid(0), date: day }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(hasAssignment(ws, paoUuid(0), day)).toBe(false);
    expect(allocationLabels(ws, paoUuid(0), day)).toContain("FÉRIAS");
    expect(ws.tryAssignShift(paoUuid(0), day, "T6")).toBe(false);
  });

  it("folga pedida bloqueia turno", () => {
    const input = minimalPaoInput(2);
    input.approvedDayOff = [{ employeeUuid: paoUuid(1), date: day }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(1), day, "T7")).toBe(false);
    expect(allocationLabels(ws, paoUuid(1), day)).toContain("FOLGA PEDIDA");
  });

  it("voo bloqueia turno", () => {
    const input = minimalPaoInput(2);
    input.flightDays = [{ employeeUuid: paoUuid(0), date: day }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), day, "T8")).toBe(false);
    expect(allocationLabels(ws, paoUuid(0), day)).toContain("VOO");
  });

  it("simulador bloqueia turno (pré-alocação manual)", () => {
    const input = realisticGenerationInput({
      lockedAllocations: [{ employeeUuid: realPaoUuid(3), date: day, label: "SIMULADOR" }],
    });
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(realPaoUuid(3), day, "T6")).toBe(false);
    expect(allocationLabels(ws, realPaoUuid(3), day)).toContain("SIMULADOR");
  });

  it("curso bloqueia turno e normaliza para CURSO ONLINE", () => {
    const input = realisticGenerationInput({
      lockedAllocations: [{ employeeUuid: realPaoUuid(4), date: day, label: "CURSO" }],
    });
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(realPaoUuid(4), day, "T6")).toBe(false);
    expect(allocationLabels(ws, realPaoUuid(4), day)).toContain("CURSO ONLINE");
  });

  it("CMA bloqueia turno", () => {
    const input = realisticGenerationInput({
      lockedAllocations: [{ employeeUuid: realPaoUuid(5), date: day, label: "CMA" }],
    });
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(realPaoUuid(5), day, "T7")).toBe(false);
    expect(allocationLabels(ws, realPaoUuid(5), day)).toContain("CMA");
  });

  it("OUTRO bloqueia turno", () => {
    const input = minimalPaoInput(2);
    input.lockedAllocations = [{ employeeUuid: paoUuid(0), date: day, label: "OUTRO" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), day, "T6")).toBe(false);
    expect(allocationLabels(ws, paoUuid(0), day)).toContain("OUTRO");
  });

  it("múltiplos bloqueios no mesmo dia impedem qualquer turno", () => {
    const input = minimalPaoInput(2);
    input.vacationDays = [{ employeeUuid: paoUuid(0), date: day }];
    input.flightDays = [{ employeeUuid: paoUuid(0), date: day }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), day, "T6")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), day, "T7")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), day, "T8")).toBe(false);
  });

  it("labels operacionais são classificados como hard block", () => {
    for (const label of ["FÉRIAS", "FOLGA PEDIDA", "VOO", "SIMULADOR", "CURSO ONLINE", "CMA", "OUTRO", "ND"]) {
      expect(isOperationalHardBlock(label)).toBe(true);
    }
  });
});
