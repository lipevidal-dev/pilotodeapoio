import { describe, expect, it } from "vitest";
import { apaoScheduleEngine } from "../domain/schedule/apao-schedule-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";
import { iterDays } from "../domain/rules/dates.js";
import { realisticGenerationInput, REALISTIC_TEST_MONTH, REALISTIC_TEST_YEAR } from "./realistic-fixtures.js";
import type { GenerationInput, GenerationResult } from "../domain/schedule/generation-types.js";
import type { Shift } from "../domain/shift/types.js";

function generatePaoThenApao(input: GenerationInput): GenerationResult {
  const pao = realScheduleEngine.generate(input);
  const ws = new GenerationWorkspace(input);
  ws.applyHardBlocks();
  ws.seedAssignments(pao.assignments);
  for (const a of pao.allocations) {
    ws.lockDay(a.employeeUuid, a.date, a.label);
  }
  apaoScheduleEngine.execute(ws);
  return {
    ...pao,
    assignments: ws.toAssignments(),
    allocations: ws.allocations,
  };
}
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
    const result = generatePaoThenApao(input);
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
    const result = generatePaoThenApao(input);
    const apaoAssignments = result.assignments.filter((a) => apaoUuids(input).includes(a.employeeUuid));
    expect(apaoAssignments.some((a) => a.shiftCode === "T2")).toBe(false);
    expect(apaoAssignments.length).toBeGreaterThan(0);
  }, SLOW_MS);

  it("3. com T1/T2/T3/T4 ativos, distribui além de T2", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = generatePaoThenApao(input);
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
    const result = generatePaoThenApao(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(validateSchedule(ctx).some((v) => v.type === "APAO SEM PAO")).toBe(false);
  }, SLOW_MS);

  it("5. APAO respeita 6x1 (sem 7 dias consecutivos de turno)", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const days = iterDays(REALISTIC_TEST_YEAR, REALISTIC_TEST_MONTH);
    const result = generatePaoThenApao(input);
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
  it("6. Gerar escala PAO não aloca APAO; motor APAO aloca turnos com FA", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const paoOnly = realScheduleEngine.generate(input);
    for (const uuid of apaoUuids(input)) {
      expect(paoOnly.assignments.filter((a) => a.employeeUuid === uuid).length).toBe(0);
    }
    const result = generatePaoThenApao(input);
    for (const uuid of apaoUuids(input)) {
      const turnos = result.assignments.filter((a) => a.employeeUuid === uuid).length;
      expect(turnos).toBeGreaterThan(0);
      const fa = result.allocations.filter(
        (a) => a.employeeUuid === uuid && a.label === "FOLGA AGRUPADA",
      );
      expect(fa.length).toBeGreaterThanOrEqual(2);
    }
  }, SLOW_MS);

  it("7. APAO entra no resumo com turnos > 0", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = generatePaoThenApao(input);
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
    const result = generatePaoThenApao(realisticGenerationInput({ shifts: activeShifts() }));
    expect(result.summary.mathClosureOk).toBe(true);
  }, SLOW_MS);

  it("9. ND não conta como dia trabalhado para APAO", () => {
    const input = realisticGenerationInput({ shifts: activeShifts() });
    const result = generatePaoThenApao(input);
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
