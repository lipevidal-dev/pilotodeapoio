import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import {
  computeTurnRateio,
  countAllocatedTurns,
} from "../domain/schedule/real-schedule-turn-rateio.js";
import { minimalPaoInput } from "./generation-fixtures.js";

function paoUuid(i = 0): string {
  return `uuid-${i + 1}`;
}

function forceAssign(ws: GenerationWorkspace, uuid: string, day: string, code: string): void {
  const emp = ws.input.employees.find((e) => e.uuid === uuid)!;
  ws["planned"].set(`${emp.domainId}|${day}`, code);
}

function forceAlloc(ws: GenerationWorkspace, uuid: string, day: string, label: string): void {
  ws.allocations.push({ employeeUuid: uuid, date: day, label });
}

describe("Dias Trabalhados — resumo operacional (display)", () => {
  it("1. 9 turnos + 2 ND = 11 Dias Trabalhados", () => {
    const input = minimalPaoInput(1);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    for (let i = 1; i <= 9; i++) {
      forceAssign(ws, uuid, `2026-06-${String(i).padStart(2, "0")}`, i % 3 === 0 ? "T8" : "T7");
    }
    forceAlloc(ws, uuid, "2026-06-10", "ND");
    forceAlloc(ws, uuid, "2026-06-11", "ND");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.turnos).toBe(9);
    expect(summary.nd).toBe(2);
    expect(summary.diasTrabalhados).toBe(11);
    expect(summary.assignedShiftCount).toBe(9);
  });

  it("2. 11 turnos + 2 ND + 1 SIM = 14 Dias Trabalhados", () => {
    const input = minimalPaoInput(1);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    for (let i = 1; i <= 11; i++) {
      forceAssign(ws, uuid, `2026-06-${String(i).padStart(2, "0")}`, "T6");
    }
    forceAlloc(ws, uuid, "2026-06-12", "ND");
    forceAlloc(ws, uuid, "2026-06-13", "ND");
    forceAlloc(ws, uuid, "2026-06-14", "SIMULADOR");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.turnos).toBe(11);
    expect(summary.simuladores).toBe(1);
    expect(summary.diasTrabalhados).toBe(14);
  });

  it("3. 9 turnos + 2 ND + 3 SIM = 14 Dias Trabalhados", () => {
    const input = minimalPaoInput(1);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    for (let i = 1; i <= 9; i++) {
      forceAssign(ws, uuid, `2026-06-${String(i).padStart(2, "0")}`, "T7");
    }
    forceAlloc(ws, uuid, "2026-06-10", "ND");
    forceAlloc(ws, uuid, "2026-06-11", "ND");
    forceAlloc(ws, uuid, "2026-06-15", "SIMULADOR");
    forceAlloc(ws, uuid, "2026-06-16", "SIMULADOR");
    forceAlloc(ws, uuid, "2026-06-17", "SIMULADOR");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.diasTrabalhados).toBe(14);
    expect(summary.turnos).toBe(9);
  });

  it("4. FP/FÉRIAS não contam em Dias Trabalhados", () => {
    const input = minimalPaoInput(1);
    input.approvedDayOff = [{ employeeUuid: paoUuid(0), date: "2026-06-05" }];
    input.vacationDays = [{ employeeUuid: paoUuid(0), date: "2026-06-06" }];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    forceAssign(ws, paoUuid(0), "2026-06-01", "T6");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === paoUuid(0))!;
    expect(summary.fp).toBeGreaterThanOrEqual(1);
    expect(summary.ferias).toBeGreaterThanOrEqual(1);
    expect(summary.diasTrabalhados).toBe(summary.turnos);
  });

  it("5. VOO/CMA/OUTRO contam em Dias Trabalhados, não em Turnos", () => {
    const input = minimalPaoInput(1);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    forceAssign(ws, uuid, "2026-06-01", "T8");
    forceAlloc(ws, uuid, "2026-06-02", "VOO");
    forceAlloc(ws, uuid, "2026-06-03", "CMA");
    forceAlloc(ws, uuid, "2026-06-04", "OUTRO");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.turnos).toBe(1);
    expect(summary.diasTrabalhados).toBe(4);
  });

  it("6. T9 conta em Turnos e Dias Trabalhados", () => {
    const input = minimalPaoInput(1);
    input.shifts = [
      ...input.shifts.map((s) => ({ ...s, coverageType: "REQUIRED" as const })),
      {
        code: "T9",
        role: "PAO" as const,
        name: "T9",
        startTime: "10:00",
        endTime: "18:00",
        minStaff: 1,
        maxStaff: 1,
        coverageType: "PARALLEL" as const,
      },
    ];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    forceAssign(ws, uuid, "2026-06-01", "T9");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(summary.turnos).toBe(1);
    expect(summary.diasTrabalhados).toBe(1);
    expect(summary.assignedShiftCount).toBe(1);
  });

  it("7. Fairness continua usando assignedShiftCount, não diasTrabalhados", () => {
    const input = minimalPaoInput(2);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    forceAssign(ws, uuid, "2026-06-01", "T6");
    forceAssign(ws, uuid, "2026-06-02", "T7");
    forceAlloc(ws, uuid, "2026-06-03", "ND");
    forceAlloc(ws, uuid, "2026-06-04", "SIMULADOR");

    const summary = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    const rateio = computeTurnRateio(ws).entries.find((e) => e.employeeUuid === uuid)!;

    expect(summary.diasTrabalhados).toBe(4);
    expect(countAllocatedTurns(ws, uuid)).toBe(2);
    expect(rateio.allocatedTurns).toBe(2);
    expect(summary.assignedShiftCount).toBe(rateio.allocatedTurns);
  });
});
