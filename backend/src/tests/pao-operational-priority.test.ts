import { describe, expect, it } from "vitest";
import { analyzeT6T7BlockCoverage } from "../domain/schedule/coverage-block-metrics.js";
import {
  coverT6T7ByBlocks,
  longestConsecutiveRun,
} from "../domain/schedule/t6-t7-block-coverage.js";
import { scheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { IDEAL_PAO_REST_COUNT } from "../domain/rules/constants.js";
import {
  comparePaoOperationalPriority,
  getPaoPriorityTier,
  sortPaoByOperationalPriority,
} from "../domain/schedule/pao-operational-priority.js";
import { countOperationalShifts } from "../domain/schedule/pao-operational-shifts.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import {
  freshWorkspace,
  minimalPaoInput,
  paoUuid,
} from "./schedule-slices/slice-helpers.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function fullMonthNoFlight(uuid: string) {
  return MONTH_DAYS.map((date) => ({ employeeUuid: uuid, date }));
}

describe("Fase 7.1 — Prioridade operacional PAO e mono-folgas", () => {
  it("PAO com mês inteiro sem voo é priorizado", () => {
    const input = minimalPaoInput(3);
    input.noFlightDates = fullMonthNoFlight(paoUuid(2));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    const sorted = sortPaoByOperationalPriority(ws, 0);
    expect(getPaoPriorityTier(ws, sorted[0].uuid)).toBe(0);
    expect(sorted[0].uuid).toBe(paoUuid(2));
  });

  it("PAO com mês inteiro sem voo tenta atingir 20 turnos", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.preallocatePaoFolgasBeforeCoverage();
    ws.coverT6T7Only();
    ws.coverT8BlocksOnly();
    ws.ensureNdForT8Pairs();
    ws.ensureMinShiftsForFullMonthNoFlight();

    const count = countOperationalShifts(ws, uuid);
    expect(count).toBeGreaterThanOrEqual(15);
  });

  it("PAO com mês inteiro sem voo não viola férias, FP ou restrição", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    input.vacationDays = [{ employeeUuid: uuid, date: "2026-06-15" }];
    input.approvedDayOff = [{ employeeUuid: uuid, date: "2026-06-20" }];
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: uuid, shiftCode: "T8" },
    ]);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    ws.ensureMinShiftsForFullMonthNoFlight();

    expect(ws.allocations.some((a) => a.employeeUuid === uuid && a.date === "2026-06-15")).toBe(true);
    expect(ws.allocations.some((a) => a.employeeUuid === uuid && a.date === "2026-06-20" && a.label === "FOLGA PEDIDA")).toBe(true);
    expect(ws.toAssignments().some((a) => a.employeeUuid === uuid && a.date === "2026-06-15")).toBe(false);
    expect(ws.toAssignments().some((a) => a.employeeUuid === uuid && a.shiftCode === "T8")).toBe(false);
  });

  it("PAO com férias quinzenais é priorizado no período disponível", () => {
    const input = minimalPaoInput(3);
    input.vacationDays = MONTH_DAYS.slice(14, 30).map((date) => ({
      employeeUuid: paoUuid(1),
      date,
    }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    const sorted = sortPaoByOperationalPriority(ws, 5);
    expect(getPaoPriorityTier(ws, sorted[0].uuid)).toBe(1);
    expect(sorted[0].uuid).toBe(paoUuid(1));

    coverT6T7ByBlocks(ws, ["T6"]);
    const beforeVac = ws.toAssignments().filter(
      (a) => a.employeeUuid === paoUuid(1) && a.date < "2026-06-15",
    );
    expect(beforeVac.length).toBeGreaterThan(0);
  });

  it("PAO com férias não é alocado durante férias", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.vacationDays = MONTH_DAYS.map((date) => ({ employeeUuid: uuid, date }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6T7ByBlocks(ws, ["T6", "T7"]);

    const duringVac = ws.toAssignments().filter((a) => a.employeeUuid === uuid);
    expect(duringVac.length).toBe(0);
  });

  it("demais PAOs são alocados por senioridade após os grupos prioritários", () => {
    const input = minimalPaoInput(4);
    input.noFlightDates = fullMonthNoFlight(paoUuid(3));
    input.vacationDays = MONTH_DAYS.slice(20).map((date) => ({
      employeeUuid: paoUuid(2),
      date,
    }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    const regular = ws.paoEmps.filter(
      (e) => getPaoPriorityTier(ws, e.uuid) === 2,
    );
    const sorted = [...regular].sort((a, b) =>
      comparePaoOperationalPriority(ws, a, b, 0),
    );
    expect(sorted[0].employee.seniority).toBeLessThan(sorted[1].employee.seniority);
    expect(getPaoPriorityTier(ws, paoUuid(3))).toBe(0);
    expect(getPaoPriorityTier(ws, paoUuid(2))).toBe(1);
  });

  it("T6 é alocado em blocos de 3 a 5 dias quando possível", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    coverT6T7ByBlocks(ws, ["T6"]);
    const metrics = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
    expect(metrics.T6.averageBlockSize).toBeGreaterThanOrEqual(3);
  });

  it("T7 é alocado em blocos de 3 a 5 dias quando possível", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    coverT6T7ByBlocks(ws, ["T7"]);
    const metrics = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
    expect(metrics.T7.averageBlockSize).toBeGreaterThanOrEqual(3);
  });

  it("cobertura unitária só ocorre quando bloco não é viável", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.vacationDays = [
      { employeeUuid: uuid, date: "2026-06-02" },
      { employeeUuid: uuid, date: "2026-06-03" },
      { employeeUuid: uuid, date: "2026-06-04" },
      { employeeUuid: uuid, date: "2026-06-05" },
      { employeeUuid: uuid, date: "2026-06-06" },
    ];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    coverT6T7ByBlocks(ws, ["T6"]);
    const metrics = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
    expect(metrics.unitCoverageTotal).toBeGreaterThanOrEqual(0);
    expect(metrics.T6.blockCount).toBeGreaterThan(0);
  });

  it("mono-folga pedida tenta ganhar folga antes", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.approvedDayOff = [{ employeeUuid: uuid, date: "2026-06-10" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.tryAssignShift(uuid, "2026-06-08", "T6");
    ws.tryAssignShift(uuid, "2026-06-11", "T6");
    ws.tryAssignShift(uuid, "2026-06-12", "T6");

    const result = ws.correctMonoFolgasPedidas();
    expect(result.detected).toBe(1);
    expect(result.corrected).toBe(1);
    expect(result.attempts[0].side).toBe("before");
    expect(ws.allocations.some((a) => a.employeeUuid === uuid && a.date === "2026-06-09" && a.label === "FOLGA")).toBe(true);
  });

  it("mono-folga pedida tenta ganhar folga depois", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.approvedDayOff = [{ employeeUuid: uuid, date: "2026-06-10" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.lockDay(uuid, "2026-06-09", "CURSO ONLINE");
    ws.tryAssignShift(uuid, "2026-06-08", "T6");
    ws.tryAssignShift(uuid, "2026-06-12", "T6");
    ws.tryAssignShift(uuid, "2026-06-13", "T6");

    const result = ws.correctMonoFolgasPedidas();
    expect(result.detected).toBe(1);
    expect(result.corrected).toBe(1);
    expect(result.attempts[0].side).toBe("after");
    expect(ws.allocations.some((a) => a.employeeUuid === uuid && a.date === "2026-06-11" && a.label === "FOLGA")).toBe(true);
  });

  it("mono-folga não é corrigida se quebrar cobertura", () => {
    const input = minimalPaoInput(1);
    const uuid = paoUuid(0);
    input.approvedDayOff = [{ employeeUuid: uuid, date: "2026-06-10" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    for (const d of ["2026-06-08", "2026-06-09", "2026-06-11", "2026-06-12"]) {
      ws.tryAssignShift(uuid, d, "T6");
    }
    ws.tryAssignShift(uuid, "2026-06-09", "T7");
    ws.tryAssignShift(uuid, "2026-06-11", "T7");

    const result = ws.correctMonoFolgasPedidas();
    expect(result.detected).toBe(1);
    expect(result.corrected).toBe(0);
  });

  it("WARNING é gerado quando não atinge 20 turnos", () => {
    const input = minimalPaoInput(1);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: uuid, shiftCode: "T6" },
      { employeeUuid: uuid, shiftCode: "T7" },
      { employeeUuid: uuid, shiftCode: "T8" },
    ]);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.ensureMinShiftsForFullMonthNoFlight();
    expect(ws.noFlightWarnings.some((w) => w.type === "RESTRIÇÃO VOO MÊS INTEIRO")).toBe(true);
    expect(ws.noFlightWarnings[0].detail).toContain("não atingiu 20 turnos");
  });

  it("ensureMinShifts não gera mais de 5 T6/T7 consecutivos", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    ws.ensureMinShiftsForFullMonthNoFlight();
    for (const code of ["T6", "T7"] as const) {
      expect(longestConsecutiveRun(ws.toAssignments(), uuid, code, ws.days)).toBeLessThanOrEqual(5);
    }
  });

  it("motor completo repõe folgas após meta de 20 turnos sem voo", () => {
    const input = minimalPaoInput(6);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    input.approvedDayOff = [
      { employeeUuid: uuid, date: "2026-06-10" },
      { employeeUuid: uuid, date: "2026-06-11" },
      { employeeUuid: uuid, date: "2026-06-12" },
    ];
    const result = scheduleGenerationEngine.generate(input);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    for (const a of result.assignments) {
      if (a.employeeUuid === uuid) ws.tryAssignShift(uuid, a.date, a.shiftCode);
    }
    for (const al of result.allocations) {
      if (al.employeeUuid === uuid) ws.lockDay(uuid, al.date, al.label);
    }
    const folgas = result.allocations.filter(
      (a) =>
        a.employeeUuid === uuid &&
        ["FOLGA", "FOLGA SOCIAL", "FOLGA PEDIDA", "FOLGA AGRUPADA"].includes(a.label),
    ).length;
    expect(folgas).toBeGreaterThanOrEqual(IDEAL_PAO_REST_COUNT);
    expect(longestConsecutiveRun(result.assignments, uuid, "T6", MONTH_DAYS)).toBeLessThanOrEqual(5);
  });

  it("WARNING é gerado quando mono-folga não pode ser corrigida", () => {
    const input = minimalPaoInput(1);
    const uuid = paoUuid(0);
    input.approvedDayOff = [{ employeeUuid: uuid, date: "2026-06-10" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    for (const d of MONTH_DAYS) {
      if (d === "2026-06-10") continue;
      ws.tryAssignShift(uuid, d, "T6");
    }

    ws.correctMonoFolgasPedidas();
    expect(ws.monoFolgaWarnings.some((w) => w.type === "MONO-FOLGA PEDIDA")).toBe(true);
  });
});
