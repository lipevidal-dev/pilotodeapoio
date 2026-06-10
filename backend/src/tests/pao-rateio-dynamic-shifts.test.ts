import { describe, expect, it } from "vitest";
import { calculateOperationalDemand } from "../domain/schedule/demand-planning-demand.js";
import { computeTurnRateio, countAllocatedTurns } from "../domain/schedule/real-schedule-turn-rateio.js";
import { allocateParallelShifts } from "../domain/schedule/real-schedule-parallel.js";
import { materializeT6T7BlocksStrict } from "../domain/schedule/real-schedule-blocks.js";
import { allocateT8BlocksStrict } from "../domain/schedule/real-schedule-t8.js";
import { computeRealMotorTargets } from "../domain/schedule/real-schedule-targets.js";
import { coverResidualT6T7Only } from "../domain/schedule/real-schedule-residual.js";
import { buildPreferredShiftMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import type { Shift } from "../domain/shift/types.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

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

function txShift(): Shift {
  return {
    code: "TX",
    role: "PAO",
    name: "Turno X PAO",
    startTime: "08:00",
    endTime: "16:00",
    minStaff: 1,
    maxStaff: 1,
    coverageType: "PARALLEL",
  };
}

function inputWithT9Preference(paoCount = 3) {
  const input = minimalPaoInput(paoCount);
  input.shifts = [
    ...input.shifts.map((s) => ({ ...s, coverageType: "REQUIRED" as const })),
    t9Shift(),
  ];
  input.preferredShifts = buildPreferredShiftMap(input.employees, [
    { employeeUuid: paoUuid(0), shiftCode: "T9" },
    { employeeUuid: paoUuid(1), shiftCode: "T9" },
  ]);
  return input;
}

function runTurnPipeline(ws: ReturnType<typeof freshWorkspace>) {
  allocateT8BlocksStrict(ws);
  const { targets } = computeRealMotorTargets(ws);
  materializeT6T7BlocksStrict(ws, targets);
  coverResidualT6T7Only(ws);
  allocateParallelShifts(ws);
}

describe("Rateio dinâmico — T9 e turnos futuros", () => {
  it("T9 PARALLEL não entra na demanda mensal obrigatória", () => {
    const shifts = [...DEFAULT_SHIFTS.map((s) => ({ ...s, coverageType: "REQUIRED" as const })), t9Shift()];
    const demand = calculateOperationalDemand(30, shifts);
    expect(demand.shiftsPerDay).toBe(3);
    expect(demand.totalDemand).toBe(90);
    expect(demand.perShift.T9).toBeUndefined();
  });

  it("turno dinâmico futuro TX não entra na demanda obrigatória", () => {
    const shifts = [...DEFAULT_SHIFTS.map((s) => ({ ...s, coverageType: "REQUIRED" as const })), txShift()];
    const demand = calculateOperationalDemand(30, shifts);
    expect(demand.perShift.TX).toBeUndefined();
    expect(demand.totalDemand).toBe(90);
  });

  it("PAO preferencial T9 participa do rateio normal com meta de turnos", () => {
    const input = inputWithT9Preference(4);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    const rateio = computeTurnRateio(ws);
    const t9Preferred = rateio.entries.filter(
      (e) => e.group === "NORMAL" && (e.employeeUuid === paoUuid(0) || e.employeeUuid === paoUuid(1)),
    );
    expect(t9Preferred.length).toBe(2);
    expect(t9Preferred.every((e) => e.turnTarget > 0)).toBe(true);
    expect(rateio.demand.perShift.T9).toBeUndefined();

    allocateParallelShifts(ws);
    const t9Count = ws.toAssignments().filter((a) => a.shiftCode === "T9").length;
    expect(t9Count).toBeGreaterThan(0);
    expect(countAllocatedTurns(ws, paoUuid(0))).toBeGreaterThan(0);
  });

  it("PAO mês inteiro sem voo participa do mesmo rateio", () => {
    const input = inputWithT9Preference(4);
    const noFlightUuid = paoUuid(2);
    input.noFlightDates = MONTH_DAYS.map((date) => ({ employeeUuid: noFlightUuid, date }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runTurnPipeline(ws);

    const rateio = computeTurnRateio(ws);
    const noFlight = rateio.entries.find((e) => e.employeeUuid === noFlightUuid)!;

    expect(noFlight.group).toBe("FULL_NO_FLIGHT");
    expect(Math.abs(noFlight.turnTarget - rateio.metaTurnosNormal)).toBeLessThanOrEqual(1);
  });

  it("simulador com horário bloqueia turno que viola descanso de 12h", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.lockedAllocations = [
      {
        employeeUuid: uuid,
        date: "2026-06-10",
        label: "SIMULADOR",
        startTime: "12:00",
        endTime: "00:00",
      },
    ];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    expect(ws.tryAssignShift(uuid, "2026-06-11", "T6")).toBe(false);
    expect(ws.tryAssignShift(uuid, "2026-06-11", "T7")).toBe(true);
  });
});
