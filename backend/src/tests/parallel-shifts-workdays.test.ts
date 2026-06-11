import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { allocateParallelShifts } from "../domain/schedule/real-schedule-parallel.js";
import {
  countAllocatedOperationalTurns,
  countAllocatedPrimaryTurns,
  isParallelShiftCode,
} from "../domain/schedule/pao-rateio-shifts.js";
import { countMotorWorkDays, countWorkdayBreakdown } from "../domain/schedule/real-schedule-workdays.js";
import { computeTurnRateio } from "../domain/schedule/real-schedule-turn-rateio.js";
import { buildPreferredShiftMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { minimalPaoInput } from "./generation-fixtures.js";

function t9Shift() {
  return {
    code: "T9",
    role: "PAO" as const,
    name: "Turno 9 PAO",
    startTime: "10:00",
    endTime: "18:00",
    minStaff: 1,
    maxStaff: 1,
    coverageType: "PARALLEL" as const,
  };
}

function paoUuid(i = 0): string {
  return `uuid-${i + 1}`;
}

function inputWithT9() {
  const input = minimalPaoInput(3);
  input.shifts = [
    ...input.shifts.map((s) => ({ ...s, coverageType: "REQUIRED" as const })),
    t9Shift(),
  ];
  return input;
}

function inputWithT9Preference() {
  const input = inputWithT9();
  input.preferredShifts = buildPreferredShiftMap(input.employees, [
    { employeeUuid: paoUuid(0), shiftCode: "T9" },
  ]);
  return input;
}

function forceAssign(ws: GenerationWorkspace, uuid: string, day: string, code: string): void {
  const emp = ws.input.employees.find((e) => e.uuid === uuid)!;
  ws["planned"].set(`${emp.domainId}|${day}`, code);
}

describe("Turnos paralelos — rateio e dias trabalhados", () => {
  it("1. funcionário com apenas T9: turnos = dias trabalhados = assignedShiftCount", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateParallelShifts(ws);

    const uuid = paoUuid(0);
    const allocated = countAllocatedOperationalTurns(ws, uuid);
    expect(allocated).toBeGreaterThan(0);
    expect(countMotorWorkDays(ws, uuid)).toBe(allocated);
    expect(countAllocatedPrimaryTurns(ws, uuid)).toBe(0);

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.diasTrabalhados).toBe(allocated);
    expect(summary.assignedShiftCount).toBe(allocated);
    expect(summary.turnos).toBe(allocated);
  });

  it("2. T6/T7/T8 + T9: turnos e dias trabalhados incluem ambos", () => {
    const input = inputWithT9();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(1);
    const primaryDays = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
    const parallelDays = ["2026-06-06", "2026-06-07", "2026-06-08"];

    for (const day of primaryDays) {
      expect(ws.tryAssignShift(uuid, day, "T7")).toBe(true);
    }
    for (const day of parallelDays) {
      forceAssign(ws, uuid, day, "T9");
    }

    const total = primaryDays.length + parallelDays.length;
    expect(countMotorWorkDays(ws, uuid)).toBe(total);
    expect(countAllocatedOperationalTurns(ws, uuid)).toBe(total);

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.diasTrabalhados).toBe(total);
    expect(summary.assignedShiftCount).toBe(total);
    expect(summary.turnos).toBe(total);
  });

  it("3. exemplo 6 T7/T8 + 5 T9 → Turnos=11, Dias Trab.=11", () => {
    const input = inputWithT9();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(2);

    for (let i = 1; i <= 6; i++) {
      const day = `2026-06-${String(i).padStart(2, "0")}`;
      forceAssign(ws, uuid, day, i % 2 === 0 ? "T8" : "T7");
    }
    for (let i = 7; i <= 11; i++) {
      const day = `2026-06-${String(i).padStart(2, "0")}`;
      forceAssign(ws, uuid, day, "T9");
    }

    const breakdown = countWorkdayBreakdown(ws, uuid);
    expect(breakdown.total).toBe(11);
    expect(countAllocatedOperationalTurns(ws, uuid)).toBe(11);

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.diasTrabalhados).toBe(11);
    expect(summary.assignedShiftCount).toBe(11);
    expect(summary.turnos).toBe(11);
  });

  it("4. T9 não infla workCount (orçamento mensal de dias trabalhados do motor)", () => {
    const input = inputWithT9();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    for (let i = 1; i <= 15; i++) {
      const day = `2026-06-${String(i).padStart(2, "0")}`;
      forceAssign(ws, uuid, day, "T9");
    }
    expect(ws.workCount(uuid)).toBe(0);

    forceAssign(ws, uuid, "2026-06-16", "T7");
    expect(ws.workCount(uuid)).toBe(1);
  });

  it("5. T9 participa da média de distribuição de turnos", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateParallelShifts(ws);

    const rateio = computeTurnRateio(ws);
    const preferred = rateio.entries.find((e) => e.employeeUuid === paoUuid(0))!;
    expect(preferred.allocatedTurns).toBeGreaterThan(0);
    expect(countAllocatedOperationalTurns(ws, paoUuid(0))).toBe(preferred.allocatedTurns);
  });

  it("6. PAO sem preferência T9 nunca recebe T9 pelo allocateParallelShifts", () => {
    const input = inputWithT9();
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateParallelShifts(ws);

    for (const emp of input.employees.slice(1)) {
      expect(countAllocatedPrimaryTurns(ws, emp.uuid)).toBeGreaterThanOrEqual(0);
      const t9Count = ws
        .toAssignments()
        .filter((a) => a.employeeUuid === emp.uuid && a.shiftCode === "T9").length;
      expect(t9Count).toBe(0);
    }
  });

  it("7. T9 respeita bloqueio operacional (simulador)", () => {
    const input = inputWithT9Preference();
    input.lockedAllocations = [
      {
        employeeUuid: paoUuid(0),
        date: "2026-06-10",
        label: "SIMULADOR",
        startTime: "12:00",
        endTime: "00:00",
      },
    ];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    expect(ws.tryAssignShift(paoUuid(0), "2026-06-11", "T9")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-12", "T9")).toBe(true);
  });

  it("8. isParallelShiftCode usa coverageType PARALLEL (não hardcode T9)", () => {
    const input = inputWithT9();
    const ws = new GenerationWorkspace(input);
    expect(isParallelShiftCode(ws, "T9")).toBe(true);
    expect(isParallelShiftCode(ws, "T7")).toBe(false);
    expect(isParallelShiftCode(ws, "T6")).toBe(false);
  });
});
