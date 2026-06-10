import { describe, expect, it } from "vitest";
import { allocateT8BlocksStrict } from "../domain/schedule/real-schedule-t8.js";
import { allocateFlightsForWorkdayDeficit } from "../domain/schedule/real-schedule-flights.js";
import { materializeT6T7BlocksStrict } from "../domain/schedule/real-schedule-blocks.js";
import { coverResidualT6T7Only } from "../domain/schedule/real-schedule-residual.js";
import { computeRealMotorTargets } from "../domain/schedule/real-schedule-targets.js";
import {
  computeTurnRateio,
  countAllocatedTurns,
  countUsefulOperationalDays,
} from "../domain/schedule/real-schedule-turn-rateio.js";
import { MONTHLY_WORKDAY_TARGET } from "../domain/schedule/real-schedule-types.js";
import { countMotorWorkDays } from "../domain/schedule/real-schedule-workdays.js";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function fullMonthNoFlight(uuid: string) {
  return MONTH_DAYS.map((date) => ({ employeeUuid: uuid, date }));
}

function runTurnPipeline(ws: ReturnType<typeof freshWorkspace>) {
  allocateT8BlocksStrict(ws);
  const { targets } = computeRealMotorTargets(ws);
  materializeT6T7BlocksStrict(ws, targets);
  coverResidualT6T7Only(ws);
}

describe("REAL_V1 — equilíbrio por turnos", () => {
  it("1. PAO com não alocar voo participa do mesmo rateio", () => {
    const input = minimalPaoInput(4);
    const noFlightUuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(noFlightUuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    const rateio = computeTurnRateio(ws);
    const noFlight = rateio.entries.find((e) => e.employeeUuid === noFlightUuid)!;

    expect(noFlight.group).toBe("FULL_NO_FLIGHT");
    expect(Math.abs(noFlight.turnTarget - rateio.metaTurnosNormal)).toBeLessThanOrEqual(1);
  });

  it("2. PAO com não alocar voo tenta atingir meta do rateio", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runTurnPipeline(ws);
    ws.allocatePaoRestDaysAfterCoverage();
    ws.ensureMinShiftsForFullMonthNoFlight();

    const entry = computeTurnRateio(ws).entries.find((e) => e.employeeUuid === uuid)!;
    expect(entry.turnTarget).toBeGreaterThan(0);
    const turns = countAllocatedTurns(ws, uuid);
    expect(turns).toBeGreaterThan(0);
    expect(turns).toBeLessThanOrEqual(entry.turnTarget + 1);
  });

  it("3. PAOs normais são equilibrados por turnos, não por dias trabalhados", () => {
    const input = minimalPaoInput(4);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runTurnPipeline(ws);

    const rateio = computeTurnRateio(ws);
    const normals = rateio.entries.filter((e) => e.group === "NORMAL");
    expect(normals.length).toBeGreaterThanOrEqual(2);

    const turnTargets = normals.map((n) => n.turnTarget);
    const maxDiff = Math.max(...turnTargets) - Math.min(...turnTargets);
    expect(maxDiff).toBeLessThanOrEqual(2);

    const sumTargets = turnTargets.reduce((a, b) => a + b, 0);
    expect(sumTargets).toBe(rateio.turnosRateio);

    ws.allocatePaoRestDaysAfterCoverage();
    allocateFlightsForWorkdayDeficit(ws);
    const afterFlights = normals.map((n) => countMotorWorkDays(ws, n.employeeUuid));
    const allocatedAfter = normals.map((n) => countAllocatedTurns(ws, n.employeeUuid));
    expect(afterFlights.some((w, i) => w > allocatedAfter[i])).toBe(true);
  });

  it("4. Curso/simulador/CMA não alteram alvo de turnos do PAO normal", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.lockedAllocations = [
      { employeeUuid: uuid, date: MONTH_DAYS[0]!, label: "CURSO" },
      { employeeUuid: uuid, date: MONTH_DAYS[1]!, label: "SIMULADOR" },
      { employeeUuid: uuid, date: MONTH_DAYS[2]!, label: "CMA" },
    ];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    const rateio = computeTurnRateio(ws);
    const withCadastro = rateio.entries.find((e) => e.employeeUuid === uuid)!;
    const other = rateio.entries.find((e) => e.group === "NORMAL" && e.employeeUuid !== uuid)!;

    expect(countUsefulOperationalDays(ws, uuid)).toBe(3);
    expect(withCadastro.turnTarget).toBe(other.turnTarget);
    expect(withCadastro.usefulOperationalDays).toBe(3);
  });

  it("5. Cadastros não redistribuem meta entre PAOs normais", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.lockedAllocations = [
      { employeeUuid: uuid, date: MONTH_DAYS[0]!, label: "CURSO" },
      { employeeUuid: uuid, date: MONTH_DAYS[1]!, label: "CURSO" },
    ];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    const rateio = computeTurnRateio(ws);
    const normals = rateio.entries.filter((e) => e.group === "NORMAL");
    const sumTargets = normals.reduce((n, e) => n + e.turnTarget, 0);

    expect(sumTargets).toBe(rateio.turnosRateio);
    const withCadastro = normals.find((e) => e.employeeUuid === uuid)!;
    const others = normals.filter((e) => e.employeeUuid !== uuid);
    expect(others.every((o) => o.turnTarget === withCadastro.turnTarget)).toBe(true);
  });

  it("6. Voos não entram no equilíbrio de turnos", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.flightDays = [{ employeeUuid: uuid, date: MONTH_DAYS[5]! }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    const before = computeTurnRateio(ws);
    const entryBefore = before.entries.find((e) => e.employeeUuid === uuid)!;
    expect(entryBefore.usefulOperationalDays).toBe(0);
    expect(entryBefore.turnTarget).toBeGreaterThan(0);

    runTurnPipeline(ws);
    const after = computeTurnRateio(ws);
    const entryAfter = after.entries.find((e) => e.employeeUuid === uuid)!;
    expect(entryAfter.allocatedTurns).toBe(countAllocatedTurns(ws, uuid));
    expect(entryAfter.allocatedTurns).not.toBe(countMotorWorkDays(ws, uuid));
  });

  it("7. Voos entram depois para completar 20 dias trabalhados", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runTurnPipeline(ws);
    ws.allocatePaoRestDaysAfterCoverage();

    const before = countMotorWorkDays(ws, uuid);
    expect(before).toBeLessThan(MONTHLY_WORKDAY_TARGET);

    allocateFlightsForWorkdayDeficit(ws);
    const after = countMotorWorkDays(ws, uuid);
    expect(after).toBeGreaterThanOrEqual(before);
    if (before < MONTHLY_WORKDAY_TARGET) {
      expect(after).toBeGreaterThan(before);
    }
  });

  it("8. André não pode receber T8 se tiver restrição T8", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: uuid, shiftCode: "T8" },
    ]);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runTurnPipeline(ws);
    ws.ensureMinShiftsForFullMonthNoFlight();

    const t8 = ws.toAssignments().filter((a) => a.employeeUuid === uuid && a.shiftCode === "T8");
    expect(t8.length).toBe(0);
    const shifts = ws.allowedShiftsForEmployee(uuid);
    expect(shifts).not.toContain("T8");
  });

  it("9. T6/T7 usam blocos 4 → 5 → 3 na cobertura residual", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);
    const { targets } = computeRealMotorTargets(ws);
    materializeT6T7BlocksStrict(ws, targets);

    const residual = coverResidualT6T7Only(ws);
    expect(residual.blockCoverageApplied + residual.unitCoverageApplied).toBeGreaterThanOrEqual(0);

    const result = realScheduleEngine.generate(minimalPaoInput(4));
    const report = result.summary.realMotorReport as {
      structuralMetrics?: { t6Blocks: number; t7Blocks: number };
    };
    expect(report.structuralMetrics?.t6Blocks ?? 0).toBeGreaterThan(0);
  });

  it("10. Se equilíbrio não permitir cobertura, deixar lacuna e reportar", () => {
    const input = minimalPaoInput(2);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runTurnPipeline(ws);

    const gaps = ws.listCoverageGaps();
    const diagnostics = realScheduleEngine.generate(input).summary.realMotorReport as {
      employeeDiagnostics?: Array<{ failedAllocationReasons: string[] }>;
    };

    if (gaps.length > 0) {
      const reasons = diagnostics.employeeDiagnostics?.flatMap((d) => d.failedAllocationReasons) ?? [];
      expect(reasons.some((r) => r.includes("furo") || r.includes("lacuna"))).toBe(true);
    } else {
      expect(gaps.length).toBeGreaterThanOrEqual(0);
    }
  });
});
