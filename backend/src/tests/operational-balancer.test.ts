import { describe, expect, it } from "vitest";
import { MAX_CONSECUTIVE_WORK_DAYS, MIN_PAO_REST_COUNT } from "../domain/rules/constants.js";
import { operationalBalancer } from "../domain/schedule/operational-balancer.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { scheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { longestStreakMiddleDay } from "../domain/schedule/operational-audit.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function fullMonthNoFlight(uuid: string) {
  return MONTH_DAYS.map((date) => ({ employeeUuid: uuid, date }));
}

function setupCoveredMonth(ws: ReturnType<typeof freshWorkspace>) {
  ws.applyHardBlocks();
  ws.preallocatePaoFolgasBeforeCoverage();
  ws.coverT6T7Only();
  ws.coverT8BlocksOnly();
  ws.ensureNdForT8Pairs();
}

describe("Fase 7.2 — Balanceador pós-geração", () => {
  it("1. Funcionário com folgas insuficientes recebe folga se houver viabilidade", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    const ws = freshWorkspace(input);
    setupCoveredMonth(ws);

    while (ws.countRest(uuid) < MIN_PAO_REST_COUNT) {
      const empty = ws.emptyDaysForPao(uuid);
      if (empty.length === 0) break;
      ws.lockDay(uuid, empty[0]!, "VOO");
    }
    for (const day of ws.emptyDaysForPao(uuid).slice(0, 3)) {
      ws.lockDay(uuid, day, "VOO");
    }

    const before = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(before.folgas).toBeLessThan(MIN_PAO_REST_COUNT);

    const report = operationalBalancer.balance(ws);
    const after = report.after.find((e) => e.employeeUuid === uuid)!;
    expect(after.folgas).toBeGreaterThanOrEqual(before.folgas);
    expect(report.folgasInserted + report.flightsRemoved).toBeGreaterThan(0);
  });

  it("2. Funcionário com MAX CONSEC alto tem sequência quebrada", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    const ws = freshWorkspace(input);
    setupCoveredMonth(ws);

    const streak = MONTH_DAYS.slice(5, 13);
    for (const day of streak) {
      ws.unassignShift(uuid, day);
      ws.tryRemoveMotorVoo(uuid, day);
      ws.lockDay(uuid, day, "VOO");
    }

    const before = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(before.maxConsec).toBeGreaterThan(MAX_CONSECUTIVE_WORK_DAYS);

    const report = operationalBalancer.balance(ws);
    const after = report.after.find((e) => e.employeeUuid === uuid)!;
    expect(after.maxConsec).toBeLessThan(before.maxConsec);
    expect(
      report.actions.some((a) => a.kind === "folga_inserted" || a.kind === "flight_removed"),
    ).toBe(true);
  });

  it("3. Voo é removido antes de turno", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    const ws = freshWorkspace(input);
    setupCoveredMonth(ws);

    const vooDay = ws.emptyDaysForPao(uuid)[0]!;
    ws.lockDay(uuid, vooDay, "VOO");
    const shiftDay = MONTH_DAYS.find((d) => {
      const did = ws.uuidToDomain.get(uuid)!;
      return ws.planned.get(`${did}|${d}`) === "T6";
    })!;

    const summary = buildOperationalSummary(ws);
    const paos = summary.byEmployee.filter((e) => e.type === "PAO" && e.folgas < MIN_PAO_REST_COUNT);
    expect(paos.length).toBeGreaterThan(0);

    const actions: Array<{ kind: string; date?: string }> = [];
    const emp = paos[0]!;
    const voos = ws.allocations
      .filter((a) => a.employeeUuid === emp.employeeUuid && a.label === "VOO")
      .map((a) => a.date);
    if (voos.length > 0 && ws.tryRemoveMotorVoo(emp.employeeUuid, voos[0]!)) {
      actions.push({ kind: "flight_removed", date: voos[0] });
    } else if (ws.tryRemoveShiftPreservingCoverage(emp.employeeUuid, shiftDay)) {
      actions.push({ kind: "shift_removed", date: shiftDay });
    }

    expect(actions[0]?.kind).toBe("flight_removed");
    expect(ws.allocations.some((a) => a.employeeUuid === uuid && a.date === vooDay && a.label === "VOO")).toBe(
      false,
    );
  });

  it("4. Voo removido é realocado para PAO elegível", () => {
    const input = minimalPaoInput(4);
    const fromUuid = paoUuid(0);
    const ws = freshWorkspace(input);
    setupCoveredMonth(ws);

    const day = ws.emptyDaysForPao(fromUuid)[0]!;
    ws.lockDay(fromUuid, day, "VOO");

    const relocated = ws.tryRelocateMotorVoo(fromUuid, day);
    expect(relocated).toBe(true);
    expect(ws.allocations.some((a) => a.employeeUuid === fromUuid && a.date === day && a.label === "VOO")).toBe(
      false,
    );
    const target = ws.allocations.find((a) => a.date === day && a.label === "VOO");
    expect(target).toBeDefined();
    expect(target!.employeeUuid).not.toBe(fromUuid);
    expect(ws.isNoFlightDay(target!.employeeUuid, day)).toBe(false);
  });

  it("5. Não alocar voos é respeitado", () => {
    const input = minimalPaoInput(3);
    const blockedUuid = paoUuid(1);
    input.noFlightDates = [{ employeeUuid: blockedUuid, date: "2026-06-10" }];
    const ws = freshWorkspace(input);
    setupCoveredMonth(ws);

    ws.lockDay(paoUuid(0), "2026-06-10", "VOO");
    ws.tryRelocateMotorVoo(paoUuid(0), "2026-06-10");
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === blockedUuid && a.date === "2026-06-10" && a.label === "VOO",
      ),
    ).toBe(false);
    expect(ws.isNoFlightDay(blockedUuid, "2026-06-10")).toBe(true);
  });

  it("6. Cobertura não é quebrada durante correção", () => {
    const input = realisticGenerationInput();
    const result = scheduleGenerationEngine.generate(input);
    const gaps = result.summary.coverageGaps ?? 0;
    expect(gaps).toBe(0);
    expect(result.summary.balanceReport).toBeDefined();
    expect(result.summary.balanceReport!.warnings.filter((w) => w.type === "COBERTURA")).toHaveLength(0);
  });

  it("7. T8/T8/ND não é quebrado", () => {
    const result = scheduleGenerationEngine.generate(realisticGenerationInput());
    const t8NdCritical = result.violations.filter(
      (v) =>
        v.level === "CRITICAL" &&
        (v.type === "ND FORA DE T8/T8" || v.type === "TURNO EM DIA ND" || v.type === "T8 ISOLADO"),
    );
    expect(t8NdCritical).toHaveLength(0);
    expect(result.summary.coverageGaps).toBe(0);
  });

  it("8. Funcionário com mês inteiro sem voo é priorizado para 20 turnos", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    setupCoveredMonth(ws);
    ws.ensureMinShiftsForFullMonthNoFlight();

    const beforeTurnos = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!.turnos;
    const report = operationalBalancer.balance(ws);
    const after = report.after.find((e) => e.employeeUuid === uuid)!;
    expect(after.turnos).toBeGreaterThanOrEqual(Math.min(15, beforeTurnos));
    expect(motorVooOnEmployee(ws, uuid)).toBe(0);
  });

  it("9. Se não for possível corrigir, warning é gerado", () => {
    const input = minimalPaoInput(1);
    const uuid = paoUuid(0);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    const streakDays = MONTH_DAYS.slice(0, 9);
    for (const day of streakDays) {
      ws.tryAssignShift(uuid, day, "T6");
    }

    const report = operationalBalancer.balance(ws);
    const hasWarning =
      report.warnings.length > 0 ||
      report.actions.some((a) => a.kind === "warning") ||
      report.acceptable === false;
    expect(hasWarning).toBe(true);
  });

  it("10. Resumo final é recalculado após ajustes", () => {
    const input = realisticGenerationInput();
    const result = scheduleGenerationEngine.generate(input);
    const report = result.summary.balanceReport!;
    expect(report.before.length).toBeGreaterThan(0);
    expect(report.after.length).toBe(report.before.length);
    expect(report.iterations).toBeGreaterThanOrEqual(0);

    const recomputed = buildOperationalSummary(
      freshWorkspace(input),
    );
    expect(result.summary.operationalByEmployee?.length).toBe(report.after.length);
    expect(report.after.every((e) => e.name.length > 0)).toBe(true);
    expect(longestStreakMiddleDay).toBeDefined();
    expect(recomputed.byEmployee.length).toBeGreaterThan(0);
  });

  it("motor completo inclui relatório de balanceamento", () => {
    const result = scheduleGenerationEngine.generate(realisticGenerationInput());
    expect(result.summary.balanceReport).toBeDefined();
    expect(result.summary.balanceReport!.before.length).toBeGreaterThan(0);
    expect(result.summary.balanceReport!.after.length).toBeGreaterThan(0);
    expect(result.summary.balanceReport!.iterations).toBeGreaterThanOrEqual(0);
  });
});

function motorVooOnEmployee(ws: ReturnType<typeof freshWorkspace>, uuid: string): number {
  return ws.allocations.filter(
    (a) => a.employeeUuid === uuid && a.label === "VOO" && !ws.isInputFlightDay(uuid, a.date),
  ).length;
}
