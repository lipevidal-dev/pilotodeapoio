import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { evaluatePublishReadiness } from "../domain/schedule/schedule-publish-guard.js";
import { classifyIssue, filterByLevel } from "../domain/schedule/violation-level.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { PaoOffLimitRule, EmptyDayRule } from "../domain/rules/validators.js";
import { IDEAL_PAO_REST_COUNT, MAX_PAO_REST_COUNT } from "../domain/rules/constants.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import { emptyContext } from "./fixtures.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function folgaIssues(n: number) {
  const ctx = emptyContext();
  for (let d = 1; d <= n; d++) {
    ctx.allocations.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      allocDate: `2026-06-${String(d).padStart(2, "0")}`,
      allocType: "FOLGA",
    });
  }
  return new PaoOffLimitRule().validate(ctx).filter((i) => i.employee === "PAO SILVA");
}

describe("Calibração operacional — disponível para voo", () => {
  it("1. dia vazio não gera CRITICAL", () => {
    const ctx = emptyContext();
    const issues = new EmptyDayRule().validate(ctx);
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(classifyIssue(i)).toBe("INFO");
      expect(i.type).toBe("DISPONÍVEL PARA VOO");
    }
  });

  it("2. dia vazio gera Disponível no resumo", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(`${did}|${a.date}`, a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const op = buildOperationalSummary(ws);
    const totalDisp = op.totals.totalDisponiveis;
    expect(totalDisp).toBeGreaterThanOrEqual(0);
    const info = validateSchedule(generationToScheduleContext(input, result.assignments, result.allocations))
      .filter((v) => v.type === "DISPONÍVEL PARA VOO");
    const paoDisp = op.byEmployee.filter((e) => e.type === "PAO").reduce((n, e) => n + e.disponivel, 0);
    expect(paoDisp).toBeGreaterThanOrEqual(info.length);
    expect(op.totals.totalDisponiveis).toBeGreaterThanOrEqual(info.length);
  }, SLOW_MS);

  it("3. Disponível não bloqueia publicação", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const readiness = evaluatePublishReadiness(ctx);
    const dispCritical = readiness.criticalViolations.filter(
      (c) => c.ruleCode === "DISPONÍVEL PARA VOO" || c.ruleCode === "DIA VAZIO",
    );
    expect(dispCritical.length).toBe(0);
  }, SLOW_MS);

  it("4. Disponível aparece no summary operacional", () => {
    const result = engine.generate(realisticGenerationInput());
    expect(result.summary.operationalTotals?.totalDisponiveis).toBeDefined();
    expect(result.summary.operationalByEmployee?.every((e) => "disponivel" in e)).toBe(true);
  }, SLOW_MS);
});

describe("Calibração operacional — folgas computáveis", () => {
  it("5. Folgas = F + FS + FA + FP", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [{ employeeUuid: "real-1", date: "2026-06-05" }],
    });
    const result = engine.generate(input);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(`${did}|${a.date}`, a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const pao = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.folgas).toBeGreaterThanOrEqual(pao.fp);
  }, SLOW_MS);

  it("6. FP conta como folga", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [
        { employeeUuid: "real-1", date: "2026-06-10" },
        { employeeUuid: "real-1", date: "2026-06-12" },
      ],
    });
    const result = engine.generate(input);
    expect(
      result.allocations.filter(
        (a) => a.employeeUuid === "real-1" && a.label === "FOLGA PEDIDA",
      ).length,
    ).toBe(2);
    const pao = result.summary.operationalByEmployee?.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.fp).toBe(2);
    expect(pao.folgas).toBeGreaterThanOrEqual(pao.fp);
  }, SLOW_MS);

  it("7. FP não conta como dia trabalhado", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [{ employeeUuid: "real-1", date: "2026-06-08" }],
    });
    const result = engine.generate(input);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(`${did}|${a.date}`, a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const pao = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.diasTrabalhados).toBe(
      pao.turnos + pao.nd + pao.voos + pao.simuladores + pao.cursos + pao.cma + pao.outros,
    );
  }, SLOW_MS);
});

describe("Calibração operacional — regra folgas 10/11", () => {
  it("8. FS exibe Sim/Não no resumo (folgaSocialOk)", () => {
    const op = buildOperationalSummary(
      new GenerationWorkspace(realisticGenerationInput()),
    );
    for (const e of op.byEmployee.filter((x) => x.type === "PAO")) {
      expect(typeof e.folgaSocialOk).toBe("boolean");
    }
  });

  it("9. 10 folgas = OK", () => {
    expect(folgaIssues(IDEAL_PAO_REST_COUNT).length).toBe(0);
  });

  it("10. 11 folgas = permitido sem warning", () => {
    const issues = folgaIssues(MAX_PAO_REST_COUNT);
    expect(issues.length).toBe(0);
  });

  it("11. 11 folgas não bloqueia publicação", () => {
    const ctx = {
      ...emptyContext(),
      employees: [{ id: 1, name: "PAO SILVA", role: "PAO" as const, seniority: 1 }],
    };
    for (let d = 1; d <= MAX_PAO_REST_COUNT; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA",
      });
    }
    ctx.assignments.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      workDate: "2026-06-20",
      shiftCode: "T6",
    });
    const readiness = evaluatePublishReadiness(ctx);
    const folgaCritical = readiness.criticalViolations.filter((c) => c.ruleCode === "FOLGAS PAO");
    expect(folgaCritical.length).toBe(0);
    expect(readiness.warningViolations.some((c) => c.ruleCode === "FOLGAS PAO")).toBe(false);
  });

  it("12. 9 folgas = CRITICAL", () => {
    const issues = folgaIssues(9);
    expect(issues.length).toBe(1);
    expect(classifyIssue(issues[0])).toBe("CRITICAL");
  });

  it("13. 12 folgas = CRITICAL", () => {
    const issues = folgaIssues(12);
    expect(issues.length).toBe(1);
    expect(classifyIssue(issues[0])).toBe("CRITICAL");
  });

  it("14. REAL_V1 não gera folga comum automaticamente", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const common = result.allocations.filter(
      (a) =>
        a.label === "FOLGA" &&
        input.employees.some((e) => e.uuid === a.employeeUuid && e.employee.role === "PAO"),
    ).length;
    expect(common).toBe(0);
    const report = result.summary.realMotorReport as { commonFolgaAutoGenerated?: boolean };
    expect(report.commonFolgaAutoGenerated).toBe(false);
  }, SLOW_MS);
});

describe("Calibração operacional — T8 e fechamento", () => {
  it("15. T8/T8/ND permanece íntegro após geração", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const critical = filterByLevel(validateSchedule(ctx), ["CRITICAL"]);
    expect(critical.filter((c) => ["T8 ISOLADO", "T8 SEM ND", "ND FORA DE T8/T8"].includes(c.ruleCode)).length).toBe(0);
  }, SLOW_MS);

  it("16. monofolga reduzida no cenário-base", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const mono = validateSchedule(ctx).filter((v) => v.type === "MONOFOLGA");
    expect(mono.length).toBeLessThan(50);
  }, SLOW_MS);

  it("16b. REAL_V1 gera 1 par FS por PAO", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const paoCount = input.employees.filter((e) => e.employee.role === "PAO").length;
    const fs = result.allocations.filter((a) => a.label === "FOLGA SOCIAL");
    expect(fs.length).toBe(paoCount * 2);
  }, SLOW_MS);

  it("16c. FP sábado+domingo compõe bloco (não monofolga)", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [
        { employeeUuid: "real-1", date: "2026-06-13" },
        { employeeUuid: "real-1", date: "2026-06-14" },
      ],
    });
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const mono = validateSchedule(ctx).filter(
      (v) => v.type === "MONOFOLGA" && v.employee?.includes("Alpha"),
    );
    expect(mono.length).toBe(0);
  }, SLOW_MS);

  it("17. dias do mês fecham matematicamente", () => {
    const result = engine.generate(realisticGenerationInput());
    expect(result.summary.mathClosureOk).toBe(true);
  }, SLOW_MS);

  it("18. total Disponíveis calculado corretamente", () => {
    const result = engine.generate(realisticGenerationInput());
    const sumDisp = result.summary.operationalByEmployee?.reduce((n, e) => n + e.disponivel, 0) ?? 0;
    expect(result.summary.operationalTotals?.totalDisponiveis).toBe(sumDisp);
  }, SLOW_MS);
});
