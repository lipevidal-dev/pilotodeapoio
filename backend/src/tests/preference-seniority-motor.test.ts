import { describe, expect, it } from "vitest";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import type { RealMotorReport } from "../domain/schedule/real-schedule-types.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import {
  buildPreferenceQuartileSummary,
  buildPreferenceSeniorityAudit,
  comparePreferenceSeniorityTieBreak,
  formatPreferenceSeniorityAudit,
} from "../domain/schedule/preference-scoring.js";
import { countRateioTurns } from "../domain/schedule/pao-rateio-shifts.js";
import {
  buildWorkspaceFromGenerationResult,
  refreshScheduleGenerationState,
} from "../domain/schedule/schedule-generation-state.js";
import {
  validateBeforeSave,
  validateGenerationBeforeSave,
} from "../domain/schedule/schedule-generation-validators.js";
import { REALISTIC_PAOS, realisticGenerationInput } from "./realistic-fixtures.js";

const engine = new RealScheduleEngine();

function allPaoPreferT7(): Map<number, Set<string>> {
  return new Map(REALISTIC_PAOS.map((_, i) => [i + 1, new Set(["T7"])]));
}

function motorReport(result: Awaited<ReturnType<typeof engine.generate>>): RealMotorReport {
  return result.summary.realMotorReport as unknown as RealMotorReport;
}

function buildWs(input: ReturnType<typeof realisticGenerationInput>, result: Awaited<ReturnType<typeof engine.generate>>) {
  return buildWorkspaceFromGenerationResult(input, result);
}

describe("preferência ponderada por senioridade — motor V4", () => {
  it("geração com preferências: gaps=0 e validateBeforeSave OK", () => {
    const input = realisticGenerationInput({ month: 7, preferredShifts: allPaoPreferT7() });
    const result = engine.generate(input);

    expect(result.summary.coverageGaps).toBe(0);

    const ws = buildWs(input, result);
    const state = refreshScheduleGenerationState(ws, {
      stage: "FINAL_AUDIT",
      motorReport: result.summary.realMotorReport,
    });
    const saveValidation = validateBeforeSave(state, ws);
    expect(saveValidation.criticalCount).toBe(0);

    const gate = validateGenerationBeforeSave(input, result);
    const critical = gate.issues.filter((i) => i.level === "CRITICAL" || i.severity === "CRÍTICA");
    expect(critical.map((i) => i.type)).toEqual([]);
  });

  it("preferência não viola min/max proporcional após geração", () => {
    const input = realisticGenerationInput({ month: 7, preferredShifts: allPaoPreferT7() });
    const result = engine.generate(input);
    const ws = buildWs(input, result);
    ws.initRateioContext();
    ws.syncRateioContext();
    const ctx = ws.rateioContext!;

    for (const c of ws.paoEmps) {
      const turns = countRateioTurns(ws, c.uuid);
      const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
      const max = ctx.maxTurnCounts.get(c.uuid) ?? Infinity;
      expect(turns).toBeGreaterThanOrEqual(min);
      expect(turns).toBeLessThanOrEqual(max);
    }
  });

  it("preferência não quebra T8/T8/ND", () => {
    const input = realisticGenerationInput({ month: 7, preferredShifts: allPaoPreferT7() });
    const result = engine.generate(input);
    const report = motorReport(result);
    expect(report.t8IsolatedCount).toBe(0);
    expect(report.t8PairsWithoutNdCount).toBe(0);
  });

  it("pré-alocação locked não é sobrescrita pela preferência", () => {
    const input = realisticGenerationInput({
      month: 7,
      preferredShifts: new Map([[1, new Set(["T7"])]]),
      lockedAllocations: [
        {
          employeeUuid: "real-1",
          date: "2026-07-10",
          label: "T6",
        },
      ],
    });
    const result = engine.generate(input);
    const locked = result.assignments.find(
      (a) => a.employeeUuid === "real-1" && a.date === "2026-07-10",
    );
    expect(locked?.shiftCode).toBe("T6");
  });

  it("auditoria inclui quartis de senioridade quando há amostra suficiente", () => {
    const input = realisticGenerationInput({ month: 7, preferredShifts: allPaoPreferT7() });
    const result = engine.generate(input);
    const ws = buildWs(input, result);
    ws.initRateioContext();
    const audit = buildPreferenceSeniorityAudit(ws, ws.rateioContext!);
    const text = formatPreferenceSeniorityAudit(audit);

    expect(text).toContain("PREFERÊNCIA X SENIORIDADE");
    expect(text).toContain("Quartil superior");
    expect(text).toContain("Quartil inferior");

    const quartiles = buildPreferenceQuartileSummary(audit);
    expect(quartiles.sampleSize).toBe(REALISTIC_PAOS.length);
    expect(quartiles.superior).toBeGreaterThanOrEqual(quartiles.inferior);
  });

  it("motorReport inclui bloco de auditoria preferência x senioridade", () => {
    const input = realisticGenerationInput({ month: 7, preferredShifts: allPaoPreferT7() });
    const result = engine.generate(input);
    const notes = motorReport(result).stepNotes.join("\n");
    expect(notes).toContain("PREFERÊNCIA X SENIORIDADE");
  });

  it("cobertura T6/T7/T8 permanece completa com preferências ativas", () => {
    const baseline = engine.generate(realisticGenerationInput({ month: 7 }));
    const withPref = engine.generate(
      realisticGenerationInput({ month: 7, preferredShifts: allPaoPreferT7() }),
    );
    expect(baseline.summary.coverageGaps).toBe(0);
    expect(withPref.summary.coverageGaps).toBe(0);
  });

  it("comparePreferenceSeniorityTieBreak: mais antigo vence em empate de target", () => {
    const input = realisticGenerationInput({
      month: 7,
      preferredShifts: new Map([
        [1, new Set(["T7"])],
        [2, new Set(["T7"])],
      ]),
    });
    const ws = new GenerationWorkspace(input);
    ws.initRateioContext();
    const ctx = ws.rateioContext!;
    const a = ws.paoEmps.find((e) => e.uuid === "real-1")!;
    const b = ws.paoEmps.find((e) => e.uuid === "real-2")!;

    ctx.currentTurnCounts.set(a.uuid, 5);
    ctx.currentTurnCounts.set(b.uuid, 5);
    ctx.targetTurnCounts.set(a.uuid, 10);
    ctx.targetTurnCounts.set(b.uuid, 10);

    expect(comparePreferenceSeniorityTieBreak(ws, ctx, a, b, "T7")).toBeLessThan(0);
  });
});
