import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import { iterDays } from "../domain/rules/dates.js";
import { realisticGenerationInput, REALISTIC_TEST_MONTH, REALISTIC_TEST_YEAR } from "./realistic-fixtures.js";
import type { Shift } from "../domain/shift/types.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function activeShifts(overrides: Partial<Record<string, Partial<Shift>>> = {}): Shift[] {
  return DEFAULT_SHIFTS.map((s) => ({
    ...s,
    active: true,
    ...overrides[s.code],
  }));
}

function apaoUuids(input: ReturnType<typeof realisticGenerationInput>): string[] {
  return input.employees.filter((e) => e.employee.role === "APAO").map((e) => e.uuid);
}

describe("Calibração APAO — turnos cadastrados e ativos", () => {
  it("1. motor usa turnos APAO ativos (T1–T4)", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = engine.generate(input);
    const codes = new Set(
      result.assignments
        .filter((a) => apaoUuids(input).includes(a.employeeUuid))
        .map((a) => a.shiftCode),
    );
    expect(codes.size).toBeGreaterThan(0);
    for (const code of codes) {
      expect(["T1", "T2", "T3", "T4"]).toContain(code);
    }
  }, SLOW_MS);

  it("2. motor ignora turno APAO inativo", () => {
    const input = realisticGenerationInput({
      shifts: activeShifts({ T2: { active: false } }),
    });
    const result = engine.generate(input);
    const apaoAssignments = result.assignments.filter((a) => apaoUuids(input).includes(a.employeeUuid));
    expect(apaoAssignments.some((a) => a.shiftCode === "T2")).toBe(false);
    expect(apaoAssignments.length).toBeGreaterThan(0);
  }, SLOW_MS);

  it("3. com T1/T2/T3/T4 ativos, distribui além de T2", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = engine.generate(input);
    const byCode: Record<string, number> = {};
    for (const a of result.assignments) {
      if (!apaoUuids(input).includes(a.employeeUuid)) continue;
      byCode[a.shiftCode] = (byCode[a.shiftCode] ?? 0) + 1;
    }
    const distinct = Object.keys(byCode).filter((c) => byCode[c] > 0);
    expect(distinct.length).toBeGreaterThan(1);
  }, SLOW_MS);

  it("4. APAO nunca sem PAO", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(validateSchedule(ctx).some((v) => v.type === "APAO SEM PAO")).toBe(false);
  }, SLOW_MS);

  it("5. APAO respeita 6x1 (sem 7 dias consecutivos de turno)", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const days = iterDays(REALISTIC_TEST_YEAR, REALISTIC_TEST_MONTH);
    const result = engine.generate(input);
    for (const uuid of apaoUuids(input)) {
      let streak = 0;
      for (const day of days) {
        const working = result.assignments.some((a) => a.employeeUuid === uuid && a.date === day);
        if (working) {
          streak++;
          expect(streak).toBeLessThanOrEqual(6);
        } else {
          streak = 0;
        }
      }
    }
  }, SLOW_MS);
});

describe("Calibração APAO — folgas e resumo", () => {
  it("6. APAO recebe folga após bloco de trabalho", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = engine.generate(input);
    for (const uuid of apaoUuids(input)) {
      const folgas = result.allocations.filter(
        (a) =>
          a.employeeUuid === uuid &&
          ["FOLGA", "FOLGA AGRUPADA"].includes(a.label.toUpperCase()),
      );
      expect(folgas.length).toBeGreaterThan(0);
    }
  }, SLOW_MS);

  it("7. APAO entra no resumo com turnos > 0", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = engine.generate(input);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(`${did}|${a.date}`, a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const op = buildOperationalSummary(ws);
    for (const apao of op.byEmployee.filter((e) => e.type === "APAO")) {
      const hadShift = result.assignments.some((a) => a.employeeUuid === apao.employeeUuid);
      if (hadShift) {
        expect(apao.turnos).toBeGreaterThan(0);
        expect(apao.diasTrabalhados).toBeGreaterThan(0);
      }
    }
  }, SLOW_MS);

  it("8. fechamento matemático inclui APAO", () => {
    const result = engine.generate(realisticGenerationInput({ shifts: activeShifts() }));
    expect(result.summary.mathClosureOk).toBe(true);
  }, SLOW_MS);

  it("9. ND não conta como dia trabalhado para APAO", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = engine.generate(input);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(`${did}|${a.date}`, a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const op = buildOperationalSummary(ws);
    for (const apao of op.byEmployee.filter((e) => e.type === "APAO")) {
      expect(apao.nd).toBe(0);
    }
  }, SLOW_MS);
});
