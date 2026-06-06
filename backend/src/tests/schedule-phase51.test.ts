import { describe, expect, it, vi } from "vitest";
import * as publishGuard from "../domain/schedule/schedule-publish-guard.js";
import { emptyContext } from "./fixtures.js";
import { evaluatePublishReadiness } from "../domain/schedule/schedule-publish-guard.js";
import { runFinalCoverageGate } from "../domain/rules/coverage-gate.js";
import { classifyIssue, filterByLevel } from "../domain/schedule/violation-level.js";
import { ScheduleRepairEngine } from "../domain/schedule/schedule-repair-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { minimalPaoInput } from "./generation-fixtures.js";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { PublishScheduleUseCase } from "../application/use-cases/publish-schedule.use-case.js";
import { PublishBlockedCriticalViolationsError } from "../application/errors/schedule.errors.js";
import type { ScheduleContext } from "../domain/schedule/types.js";

function ctxWith(assignments: ScheduleContext["assignments"], allocations: ScheduleContext["allocations"] = []): ScheduleContext {
  const ctx = emptyContext(2026, 6);
  ctx.assignments = assignments;
  ctx.allocations = allocations;
  return ctx;
}

/** Cobertura T6/T7/T8 para um dia com 3 PAOs distintos. */
function fullCoverageDay(day: string): ScheduleContext["assignments"] {
  return [
    { employeeId: 1, employeeName: "PAO SILVA", workDate: day, shiftCode: "T6" },
    { employeeId: 2, employeeName: "PAO SANTOS", workDate: day, shiftCode: "T7" },
    { employeeId: 3, employeeName: "PAO OLIVEIRA", workDate: day, shiftCode: "T8" },
  ];
}

describe("Coverage gate — rule codes CRITICAL", () => {
  it("gera COVERAGE_MISSING_T6 quando falta T6", () => {
    const ctx = ctxWith([
      { employeeId: 2, employeeName: "PAO SANTOS", workDate: "2026-06-01", shiftCode: "T7" },
      { employeeId: 3, employeeName: "PAO OLIVEIRA", workDate: "2026-06-01", shiftCode: "T8" },
    ]);
    const gate = runFinalCoverageGate(ctx);
    expect(gate.issues.some((i) => i.type === "COVERAGE_MISSING_T6")).toBe(true);
    expect(classifyIssue(gate.issues[0])).toBe("CRITICAL");
  });

  it("gera COVERAGE_MISSING_T7 quando falta T7", () => {
    const ctx = ctxWith([
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-01", shiftCode: "T6" },
      { employeeId: 3, employeeName: "PAO OLIVEIRA", workDate: "2026-06-01", shiftCode: "T8" },
    ]);
    const gate = runFinalCoverageGate(ctx);
    expect(gate.issues.some((i) => i.type === "COVERAGE_MISSING_T7")).toBe(true);
  });

  it("gera COVERAGE_MISSING_T8 quando falta T8", () => {
    const ctx = ctxWith([
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-01", shiftCode: "T6" },
      { employeeId: 2, employeeName: "PAO SANTOS", workDate: "2026-06-01", shiftCode: "T7" },
    ]);
    const gate = runFinalCoverageGate(ctx);
    expect(gate.issues.some((i) => i.type === "COVERAGE_MISSING_T8")).toBe(true);
  });
});

describe("Publicação bloqueada — violações críticas", () => {
  it("bloqueia escala sem T6", () => {
    const ctx = ctxWith([
      { employeeId: 2, employeeName: "PAO SANTOS", workDate: "2026-06-01", shiftCode: "T7" },
      { employeeId: 3, employeeName: "PAO OLIVEIRA", workDate: "2026-06-01", shiftCode: "T8" },
    ]);
    const r = evaluatePublishReadiness(ctx);
    expect(r.canPublish).toBe(false);
    expect(r.criticalViolations.some((v) => v.ruleCode === "COVERAGE_MISSING_T6")).toBe(true);
  });

  it("bloqueia escala sem T7", () => {
    const ctx = ctxWith([
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-01", shiftCode: "T6" },
      { employeeId: 3, employeeName: "PAO OLIVEIRA", workDate: "2026-06-01", shiftCode: "T8" },
    ]);
    expect(evaluatePublishReadiness(ctx).canPublish).toBe(false);
  });

  it("bloqueia escala sem T8", () => {
    const ctx = ctxWith([
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-01", shiftCode: "T6" },
      { employeeId: 2, employeeName: "PAO SANTOS", workDate: "2026-06-01", shiftCode: "T7" },
    ]);
    expect(evaluatePublishReadiness(ctx).canPublish).toBe(false);
  });

  it("bloqueia APAO sem PAO", () => {
    const ctx = ctxWith([
      { employeeId: 4, employeeName: "APAO LIMA", workDate: "2026-06-10", shiftCode: "T2" },
    ]);
    const r = evaluatePublishReadiness(ctx);
    expect(r.canPublish).toBe(false);
    expect(r.criticalViolations.some((v) => v.ruleCode === "APAO SEM PAO")).toBe(true);
  });

  it("bloqueia funcionário em férias", () => {
    const ctx = ctxWith(
      [{ employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-10", shiftCode: "T6" }],
      [{ employeeId: 1, employeeName: "PAO SILVA", allocDate: "2026-06-10", allocType: "FÉRIAS" }],
    );
    const r = evaluatePublishReadiness(ctx);
    expect(r.canPublish).toBe(false);
    expect(
      r.criticalViolations.some(
        (v) => v.ruleCode === "TRABALHO EM FÉRIAS" || v.ruleCode === "TRABALHO EM DIA BLOQUEADO",
      ),
    ).toBe(true);
  });

  it("bloqueia funcionário em FP", () => {
    const ctx = ctxWith(
      [{ employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-11", shiftCode: "T6" }],
      [{ employeeId: 1, employeeName: "PAO SILVA", allocDate: "2026-06-11", allocType: "FOLGA PEDIDA" }],
    );
    const r = evaluatePublishReadiness(ctx);
    expect(r.canPublish).toBe(false);
    expect(r.criticalViolations.some((v) => v.ruleCode === "TRABALHO EM DIA BLOQUEADO")).toBe(true);
  });
});

describe("RepairEngine", () => {
  it(
    "preenche T6 quando há PAO elegível",
    () => {
      const input = minimalPaoInput(3);
      const ws = new GenerationWorkspace(input);
      ws.applyHardBlocks();
      const day = "2026-06-15";
      ws.tryAssignShift("uuid-2", day, "T7");
      ws.tryAssignShift("uuid-3", day, "T8");
      expect(ws.hasPaoCoverage(day, "T6")).toBe(false);

      const repair = new ScheduleRepairEngine().repair(ws, []);
      expect(repair.repaired).toBeGreaterThan(0);
      expect(ws.hasPaoCoverage(day, "T6")).toBe(true);
    },
    30_000,
  );
});

describe("ScheduleGenerationEngine — suggestions", () => {
  it("retorna suggestions quando não consegue reparar com 1 PAO", () => {
    const result = new ScheduleGenerationEngine().generate(minimalPaoInput(1));
    expect(
      result.suggestions.length > 0 || result.summary.coverageGaps > 0 || !result.success,
    ).toBe(true);
    const critical = filterByLevel(result.violations, ["CRITICAL"]);
    expect(critical.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("PublishScheduleUseCase — integração", () => {
  it("lança PUBLISH_BLOCKED_CRITICAL_VIOLATIONS quando há furo", async () => {
    const mockSchedule = {
      findMonthById: async () => ({
        id: "m1",
        year: 2026,
        month: 6,
        status: "GENERATED",
        assignments: [
          {
            id: "a1",
            scheduleMonthId: "m1",
            employeeId: "e1",
            date: new Date("2026-06-01T12:00:00.000Z"),
            shiftCode: "T7",
            label: null,
            source: "GENERATOR",
            employee: { id: "e1", name: "PAO Exemplo 1", type: "PAO", active: true },
          },
        ],
        preAllocations: [],
        ruleViolations: [],
      }),
      listShifts: async () => [],
      listActiveEmployees: async () => [
        { id: "e1", name: "PAO Exemplo 1", type: "PAO", active: true },
      ],
      publishMonth: async () => {
        throw new Error("must not publish");
      },
    };
    const uc = new PublishScheduleUseCase(mockSchedule as never);
    await expect(uc.execute("m1")).rejects.toBeInstanceOf(PublishBlockedCriticalViolationsError);
  });

  it("publica quando guard não encontra críticas", async () => {
    vi.spyOn(publishGuard, "evaluatePublishReadiness").mockReturnValue({
      canPublish: true,
      criticalViolations: [],
      warningViolations: [],
      infoViolations: [],
      allIssues: [],
    });

    let published = false;
    const mockSchedule = {
      findMonthById: async () => ({
        id: "m-ok",
        year: 2026,
        month: 6,
        status: "GENERATED",
        assignments: [],
        preAllocations: [],
        ruleViolations: [],
      }),
      listShifts: async () => [],
      listActiveEmployees: async () => [],
      publishMonth: async () => {
        published = true;
        return { id: "m-ok", year: 2026, month: 6, status: "PUBLISHED" };
      },
    };

    const uc = new PublishScheduleUseCase(mockSchedule as never);
    const result = await uc.execute("m-ok");
    expect(published).toBe(true);
    expect(result.status).toBe("PUBLISHED");
    vi.restoreAllMocks();
  });
});

describe("evaluatePublishReadiness — cenário cobertura diária", () => {
  it("sem critical em um dia com T6/T7/T8 (demais dias ainda críticos)", () => {
    const ctx = ctxWith(fullCoverageDay("2026-06-01"));
    const r = evaluatePublishReadiness(ctx);
    expect(r.criticalViolations.some((v) => v.ruleCode.startsWith("COVERAGE_MISSING"))).toBe(true);
  });
});
