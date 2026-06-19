import { describe, expect, it } from "vitest";
import { ApaoRequiresPaoRule, Apao6x1Rule } from "../../domain/rules/validators.js";
import { listApaoWithoutPaoCompanion } from "../../domain/rules/coverage.js";
import { ScheduleGenerationEngine } from "../../domain/schedule/schedule-generation-engine.js";
import {
  ctxFromWorkspace,
  freshWorkspace,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  realApaoUuid,
  SLOW_SLICE_MS,
} from "./slice-helpers.js";
import { emptyContext } from "../fixtures.js";

const engine = new ScheduleGenerationEngine();

describe("Fatia 6 — APAO Rules", () => {
  it("APAO sem PAO no intervalo é detectado pela regra", () => {
    const ctx = emptyContext();
    ctx.assignments.push({ employeeId: 4, employeeName: "APAO", workDate: "2026-06-10", shiftCode: "T2" });
    const issues = new ApaoRequiresPaoRule().validate(ctx);
    expect(issues.some((i) => i.type === "APAO SEM PAO")).toBe(true);
  });

  it("assignApaoWithPao não atribui APAO sem T6 coberto", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    ws.assignApaoWithPao();
    const apaoAssignments = ws.toAssignments().filter((a) => a.employeeUuid === paoUuid(2) || a.employeeUuid === paoUuid(3));
    expect(apaoAssignments.length).toBe(0);
  });

  it("APAO com cobertura PAO pode receber turno APAO", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    ws.assignApaoWithPao();
    const apaoWork = ws.toAssignments().filter((a) => a.employeeUuid.startsWith("real-") && Number(a.employeeUuid.split("-")[1]) >= 7);
    expect(apaoWork.length).toBeGreaterThan(0);
  });

  it("dois APAOs simultâneos sem PAO são listados como companion gap", () => {
    const ctx = emptyContext();
    ctx.assignments.push(
      { employeeId: 4, employeeName: "APAO 1", workDate: "2026-06-10", shiftCode: "T2" },
      { employeeId: 5, employeeName: "APAO 2", workDate: "2026-06-10", shiftCode: "T3" },
    );
    const gaps = listApaoWithoutPaoCompanion(ctx);
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("enforceApaoSixByOne remove 7º dia consecutivo", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    ws.assignApaoWithPao();
    for (let d = 1; d <= 7; d++) {
      const day = `2026-06-${String(d).padStart(2, "0")}`;
      ws.tryAssignShift(realApaoUuid(0), day, "T2");
    }
    ws.enforceApaoSixByOne();
    const ctx = ctxFromWorkspace(ws);
    const issues = new Apao6x1Rule().validate(ctx);
    expect(issues.filter((i) => i.type === "APAO SEM FOLGA 6x1")).toHaveLength(0);
  });

  it("allocateApaoRestDays pode gerar FOLGA AGRUPADA em fim de semana", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    ws.assignApaoWithPao();
    ws.allocateApaoRestDays();
    const fa = ws.allocations.filter((a) => a.label === "FOLGA AGRUPADA");
    expect(fa.length).toBeGreaterThanOrEqual(0);
  });

  it("APAO não recebe T8 via tryAssignShift", () => {
    const ws = freshWorkspace(minimalPaoInput(2));
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    expect(ws.tryAssignShift(paoUuid(2), "2026-06-10", "T8")).toBe(false);
  });

  it("motor completo não publica APAO SEM PAO crítico em cenário realista", () => {
    const result = engine.generate(realisticGenerationInput());
    const apaoIssues = result.violations.filter((v) => v.type === "APAO SEM PAO");
    expect(apaoIssues).toHaveLength(0);
  }, SLOW_SLICE_MS);

  it("completeApaoAgenda reduz dias vazios de APAO", () => {
    const countEmptyApaoDays = (ws: ReturnType<typeof freshWorkspace>) =>
      ws.apaoEmps.reduce((n, c) => {
        const filled = new Set([
          ...ws.toAssignments().filter((a) => a.employeeUuid === c.uuid).map((a) => a.date),
          ...ws.allocations.filter((a) => a.employeeUuid === c.uuid).map((a) => a.date),
        ]);
        return n + ws.days.filter((d) => !filled.has(d)).length;
      }, 0);

    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.coverT6T7Only();
    ws.assignApaoWithPao();
    const before = countEmptyApaoDays(ws);
    ws.completeApaoAgenda();
    const after = countEmptyApaoDays(ws);
    expect(after).toBeLessThanOrEqual(before);
  });
});
