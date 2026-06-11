import { describe, expect, it } from "vitest";
import {
  calculateRequiredCoverageDemand,
  calculateTurnRateioDemand,
} from "../domain/schedule/demand-planning-demand.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { allocateParallelShifts } from "../domain/schedule/real-schedule-parallel.js";
import {
  computeTurnRateio,
  countAllocatedTurns,
  countUsefulOperationalDays,
} from "../domain/schedule/real-schedule-turn-rateio.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { buildPreferredShiftMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import type { Shift } from "../domain/shift/types.js";
import { minimalPaoInput } from "./generation-fixtures.js";

function t9Shift(): Shift {
  return {
    code: "T9",
    role: "PAO",
    name: "Turno 9 PAO",
    startTime: "10:00",
    endTime: "18:00",
    minStaff: 1,
    maxStaff: 1,
    coverageType: "PARALLEL",
  };
}

function paoUuid(i = 0): string {
  return `uuid-${i + 1}`;
}

function julyInput(paoCount = 8) {
  const input = minimalPaoInput(paoCount);
  input.year = 2026;
  input.month = 7;
  input.shifts = [
    ...input.shifts.map((s) => ({ ...s, coverageType: "REQUIRED" as const })),
    t9Shift(),
  ];
  return input;
}

describe("Fórmula definitiva de rateio de turnos", () => {
  it("1. Julho/2026 — 31 dias, 8 PAOs, demanda 93, média 11,625", () => {
    const demand = calculateTurnRateioDemand(31, DEFAULT_SHIFTS);
    expect(demand.totalDemand).toBe(93);
    expect(demand.shiftsPerDay).toBe(3);

    const input = julyInput(8);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const rateio = computeTurnRateio(ws);
    expect(rateio.turnosRateio).toBe(93);
    expect(rateio.metaTurnosNormal).toBeCloseTo(11.625, 3);

    const targets = rateio.entries.map((e) => e.turnTarget);
    expect(targets.reduce((a, b) => a + b, 0)).toBe(93);
    expect(Math.max(...targets) - Math.min(...targets)).toBeLessThanOrEqual(1);
  });

  it("2. T9 participa do balanceamento (conta em assignedShiftCount)", () => {
    const input = julyInput(4);
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    for (let i = 1; i <= 12; i++) {
      const day = `2026-07-${String(i).padStart(2, "0")}`;
      ws["planned"].set(`${ws.input.employees[0]!.domainId}|${day}`, "T9");
    }

    const entry = computeTurnRateio(ws).entries.find((e) => e.employeeUuid === paoUuid(0))!;
    expect(entry.allocatedTurns).toBe(12);
    expect(entry.turnDeviation).toBeCloseTo(12 - entry.turnTarget, 0);
  });

  it("3. T9 não aumenta demanda obrigatória", () => {
    const shifts = [...DEFAULT_SHIFTS.map((s) => ({ ...s, coverageType: "REQUIRED" as const })), t9Shift()];
    const required = calculateRequiredCoverageDemand(31, shifts);
    const rateioDemand = calculateTurnRateioDemand(31, shifts);
    expect(required.totalDemand).toBe(93);
    expect(rateioDemand.totalDemand).toBe(93);
    expect(rateioDemand.perShift.T9).toBeUndefined();
  });

  it("4. PAO preferencial T9 recebe T9 até meta sem excesso", () => {
    const input = julyInput(4);
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
      { employeeUuid: paoUuid(1), shiftCode: "T9" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const rateioBefore = computeTurnRateio(ws);
    const target = rateioBefore.entries.find((e) => e.employeeUuid === paoUuid(0))!.turnTarget;

    for (let i = 1; i <= target; i++) {
      const day = `2026-07-${String(i).padStart(2, "0")}`;
      ws["planned"].set(`${ws.input.employees[0]!.domainId}|${day}`, "T9");
    }

    allocateParallelShifts(ws);
    const allocated = countAllocatedTurns(ws, paoUuid(0));
    expect(allocated).toBeLessThanOrEqual(target + 1);
    expect(allocated).toBeGreaterThanOrEqual(target - 1);
  });

  it("4b. PAO sem preferência T9 nunca recebe T9", () => {
    const input = julyInput(4);
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateParallelShifts(ws);

    for (const emp of input.employees.slice(1)) {
      const t9 = ws
        .toAssignments()
        .filter((a) => a.employeeUuid === emp.uuid && a.shiftCode === "T9").length;
      expect(t9).toBe(0);
    }
  });

  it("4c. T9 conta como turno e dia trabalhado no resumo", () => {
    const input = julyInput(2);
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws["planned"].set(`${ws.input.employees[0]!.domainId}|2026-07-01`, "T7");
    ws["planned"].set(`${ws.input.employees[0]!.domainId}|2026-07-02`, "T9");
    ws["planned"].set(`${ws.input.employees[0]!.domainId}|2026-07-03`, "T9");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === paoUuid(0))!;
    expect(summary.turnos).toBe(3);
    expect(summary.diasTrabalhados).toBe(3);
    expect(summary.assignedShiftCount).toBe(3);
  });

  it("5. SIM/CRS/CMA/OUTRO não alteram meta matemática de turnos", () => {
    const input = julyInput(3);
    const uuid = paoUuid(0);
    input.lockedAllocations = [
      { employeeUuid: uuid, date: "2026-07-01", label: "CURSO" },
      { employeeUuid: uuid, date: "2026-07-02", label: "SIMULADOR" },
      { employeeUuid: uuid, date: "2026-07-03", label: "CMA" },
      { employeeUuid: uuid, date: "2026-07-04", label: "OUTRO" },
    ];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    const rateio = computeTurnRateio(ws);
    const withCadastro = rateio.entries.find((e) => e.employeeUuid === uuid)!;
    const other = rateio.entries.find((e) => e.employeeUuid === paoUuid(1))!;

    expect(countUsefulOperationalDays(ws, uuid)).toBe(4);
    expect(withCadastro.turnTarget).toBe(other.turnTarget);
    expect(withCadastro.usefulOperationalDays).toBe(4);
  });

  it("6. bloqueios operacionais continuam impedindo conflitos", () => {
    const input = julyInput(2);
    const uuid = paoUuid(0);
    input.lockedAllocations = [
      {
        employeeUuid: uuid,
        date: "2026-07-10",
        label: "SIMULADOR",
        startTime: "12:00",
        endTime: "00:00",
      },
    ];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    expect(ws.tryAssignShift(uuid, "2026-07-11", "T6")).toBe(false);
    expect(ws.tryAssignShift(uuid, "2026-07-11", "T7")).toBe(true);
  });

  it("7. coverageEmergency não é usado para T9", () => {
    const input = julyInput(2);
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    const tryEmergency = ws.tryAssignShift.bind(ws);
    expect(tryEmergency(paoUuid(0), "2026-07-05", "T9", true)).toBe(false);
    expect(tryEmergency(paoUuid(0), "2026-07-05", "T9", false)).toBe(true);
  });
});
