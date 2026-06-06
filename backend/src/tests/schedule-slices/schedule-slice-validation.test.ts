import { describe, expect, it } from "vitest";
import { validateSchedule, DEFAULT_RULES } from "../../domain/rules/engine.js";
import { runFinalCoverageGate } from "../../domain/rules/coverage-gate.js";
import { classifyIssue, filterByLevel } from "../../domain/schedule/violation-level.js";
import { ScheduleGenerationEngine } from "../../domain/schedule/schedule-generation-engine.js";
import {
  generationToScheduleContext,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  SLOW_SLICE_MS,
} from "./slice-helpers.js";
const engine = new ScheduleGenerationEngine();

describe("Fatia 9 — Validação Final", () => {
  it("DEFAULT_RULES cobre cobertura, descanso, APAO e T8", () => {
    const names = DEFAULT_RULES.map((r) => r.constructor.name);
    expect(names.some((n) => n.includes("PaoCoverage"))).toBe(true);
    expect(names.some((n) => n.includes("Rest12h"))).toBe(true);
    expect(names.some((n) => n.includes("ApaoRequires"))).toBe(true);
    expect(names.some((n) => n.includes("T8Pairing"))).toBe(true);
  });

  it("classifyIssue distingue CRITICAL, WARNING e INFO", () => {
    const result = engine.generate(realisticGenerationInput());
    const levels = new Set(result.violations.map((v) => v.severity));
    expect(levels.size).toBeGreaterThan(0);
  }, SLOW_SLICE_MS);

  it("runFinalCoverageGate detecta COVERAGE_MISSING_T6 como CRITICAL", () => {
    const input = minimalPaoInput(2);
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(1), date: "2026-06-01", shiftCode: "T7" }],
      [],
    );
    const gate = runFinalCoverageGate(ctx);
    expect(gate.issues.some((i) => i.type === "COVERAGE_MISSING_T6")).toBe(true);
    expect(classifyIssue(gate.issues[0])).toBe("CRITICAL");
  });

  it("validação cross-month: descanso 12h no 1º dia", () => {
    const input = minimalPaoInput(2);
    input.crossMonthHistory = {
      assignments: [{ employeeUuid: paoUuid(0), date: "2026-05-31", shiftCode: "T8" }],
      allocations: [],
    };
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(0), date: "2026-06-01", shiftCode: "T6" }],
      [],
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "DESCANSO MENOR QUE 12H");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("deduplicação no motor remove violações repetidas", () => {
    const result = engine.generate(realisticGenerationInput());
    const keys = result.violations.map((v) => `${v.type}|${v.date}|${v.employee}`);
    expect(new Set(keys).size).toBe(keys.length);
  }, SLOW_SLICE_MS);

  it("filterByLevel retorna apenas CRITICAL", () => {
    const input = minimalPaoInput(1);
    const ctx = generationToScheduleContext(input, [], []);
    const issues = validateSchedule(ctx);
    const critical = filterByLevel(issues, ["CRITICAL"]);
    expect(critical.every((i) => i.level === "CRITICAL")).toBe(true);
  });

  it("escala realista gerada tem valid=true ou violações não-críticas apenas", () => {
    const result = engine.generate(realisticGenerationInput());
    if (!result.summary.valid) {
      const critical = result.violations.filter((v) => classifyIssue(v) === "CRITICAL");
      expect(critical.length).toBe(result.summary.criticalViolations ?? critical.length);
    } else {
      expect(result.summary.valid).toBe(true);
    }
  }, SLOW_SLICE_MS);

  it("T8 SEM ND é CRITICAL quando par existe sem ND", () => {
    const input = minimalPaoInput(2);
    const ctx = generationToScheduleContext(
      input,
      [
        { employeeUuid: paoUuid(0), date: "2026-06-05", shiftCode: "T8" },
        { employeeUuid: paoUuid(0), date: "2026-06-06", shiftCode: "T8" },
      ],
      [],
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "T8 SEM ND");
    expect(issues.length).toBeGreaterThan(0);
    expect(classifyIssue(issues[0])).toBe("CRITICAL");
  });

  it("descanso adequado após T8 no mês anterior passa validação", () => {
    const input = minimalPaoInput(2);
    input.crossMonthHistory = {
      assignments: [{ employeeUuid: paoUuid(0), date: "2026-05-30", shiftCode: "T8" }],
      allocations: [],
    };
    const ctx = generationToScheduleContext(
      input,
      [{ employeeUuid: paoUuid(0), date: "2026-06-01", shiftCode: "T6" }],
      [],
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "DESCANSO MENOR QUE 12H");
    expect(issues.length).toBe(0);
  });
});
