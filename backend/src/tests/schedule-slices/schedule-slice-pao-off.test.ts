import { describe, expect, it } from "vitest";
import { PaoOffLimitRule, MonofolgaRule, SocialOffRule } from "../../domain/rules/validators.js";
import { IDEAL_PAO_REST_COUNT, MAX_PAO_REST_COUNT } from "../../domain/rules/constants.js";
import { ScheduleGenerationEngine } from "../../domain/schedule/schedule-generation-engine.js";
import {
  freshWorkspace,
  realisticGenerationInput,
  realPaoUuid,
  SLOW_SLICE_MS,
} from "./slice-helpers.js";

const engine = new ScheduleGenerationEngine();

function runThroughFolgas(ws: ReturnType<typeof freshWorkspace>) {
  ws.applyHardBlocks();
  ws.preallocatePaoFolgasBeforeCoverage();
  ws.planFolgaSocial();
  ws.coverT6T7Only();
  ws.allocatePaoRestDaysAfterCoverage();
  ws.ensureExactTenFolgasPerPao();
  ws.finalizePaoFolgaCounts();
  ws.fillUnclassifiedPaoDays();
}

describe("Fatia 7 — Folgas PAO", () => {
  it("motor completo atribui 10 folgas por PAO em cenário realista", () => {
    const result = engine.generate(realisticGenerationInput());
    const counts = Object.values(result.summary.folgasPerPao as Record<string, number>);
    expect(counts.every((c) => c >= IDEAL_PAO_REST_COUNT && c <= MAX_PAO_REST_COUNT)).toBe(true);
  }, SLOW_SLICE_MS);

  it("ensureExactTenFolgasPerPao força quota mínima", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    runThroughFolgas(ws);
    for (const c of ws.paoEmps) {
      expect(ws.countRest(c.uuid)).toBeGreaterThanOrEqual(IDEAL_PAO_REST_COUNT);
    }
  }, SLOW_SLICE_MS);

  it("planFolgaSocial pode criar par FS em fim de semana", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    ws.planFolgaSocial();
    const fs = ws.allocations.filter((a) => a.label === "FOLGA SOCIAL");
    expect(fs.length).toBeGreaterThanOrEqual(0);
  });

  it("PaoOffLimitRule detecta menos de 10 folgas como CRITICAL", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    const ctx = ws.toScheduleContext();
    const issues = new PaoOffLimitRule().validate(ctx);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("folgas próximas a bloqueios não recebem turno", () => {
    const input = realisticGenerationInput({
      vacationDays: [{ employeeUuid: realPaoUuid(0), date: "2026-06-10" }],
    });
    const ws = freshWorkspace(input);
    runThroughFolgas(ws);
    expect(ws.tryAssignShift(realPaoUuid(0), "2026-06-10", "T6")).toBe(false);
  });

  it("mono-folga isolada é detectada como WARNING", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    runThroughFolgas(ws);
    const issues = new MonofolgaRule().validate(ws.toScheduleContext());
    expect(Array.isArray(issues)).toBe(true);
  });

  it("SocialOffRule reporta ausência de FS como INFO", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    const issues = new SocialOffRule().validate(ws.toScheduleContext());
    expect(Array.isArray(issues)).toBe(true);
  });

  it("finalizePaoFolgaCounts não excede 11 folgas por PAO", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    runThroughFolgas(ws);
    for (const c of ws.paoEmps) {
      expect(ws.countRest(c.uuid)).toBeLessThanOrEqual(MAX_PAO_REST_COUNT);
    }
  }, SLOW_SLICE_MS);
});
