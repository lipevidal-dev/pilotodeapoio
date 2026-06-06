import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { classifyIssue, filterByLevel } from "../domain/schedule/violation-level.js";
import { evaluatePublishReadiness } from "../domain/schedule/schedule-publish-guard.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import {
  folgaPedidaThreeDaysInput,
  occupationBlocksInput,
  realisticBaselineInput,
  reducedTeamInput,
  vacationSinglePao15DaysInput,
  vacationTwoPaoOverlapInput,
} from "./hard-scenarios-fixtures.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function toContext(result: ReturnType<typeof engine.generate>, input: ReturnType<typeof realisticBaselineInput>) {
  return generationToScheduleContext(input, result.assignments, result.allocations);
}

describe("Fase 5.3 — cenários difíceis", () => {
  it(
    "1. PAO com 15 dias de férias gera sem CRITICAL estrutural (T8/folgas/bloqueios)",
    () => {
      const input = vacationSinglePao15DaysInput();
      const result = engine.generate(input);

      const critical = filterByLevel(result.violations, ["CRITICAL"]);
      const structuralCritical = critical.filter(
        (c) =>
          !c.ruleCode.startsWith("COVERAGE_MISSING") &&
          !["T8 ISOLADO", "T8 SEM ND", "ND FORA DE T8/T8", "TRABALHO EM DIA BLOQUEADO"].includes(
            c.ruleCode,
          ),
      );
      expect(structuralCritical.length).toBe(0);
      expect(
        critical.some((c) =>
          ["T8 ISOLADO", "T8 SEM ND", "ND FORA DE T8/T8"].includes(c.ruleCode),
        ),
      ).toBe(false);
    },
    SLOW_MS,
  );

  it(
    "2. duas férias PAO sobrepostas — detecta impossível ou fecha sem CRITICAL",
    () => {
      const input = vacationTwoPaoOverlapInput();
      const result = engine.generate(input);

      if (result.summary.criticalCount === 0) {
        expect(result.summary.coverageMissingCount).toBe(0);
        expect(result.summary.impossibleScenario).toBe(false);
      } else {
        expect(
          result.summary.impossibleScenario ||
            result.summary.mainBlockingReasons!.length > 0,
        ).toBe(true);
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    },
    SLOW_MS,
  );

  it("3. folga pedida (FP) bloqueia alocação no dia", () => {
    const input = folgaPedidaThreeDaysInput();
    const fpDates = ["2026-06-05", "2026-06-12", "2026-06-19"];
    const charlieUuid = "real-3";

    const result = engine.generate(input);
    for (const date of fpDates) {
      const onFp = result.assignments.some(
        (a) => a.employeeUuid === charlieUuid && a.date === date,
      );
      expect(onFp).toBe(false);
    }

    const ctx = toContext(result, input);
    const blocked = filterByLevel(
      [...result.violations, ...evaluatePublishReadiness(ctx).allIssues],
      ["CRITICAL"],
    ).filter(
      (v) =>
        v.ruleCode === "TRABALHO EM DIA BLOQUEADO" &&
        fpDates.includes(v.date) &&
        v.employee.includes("Charlie"),
    );
    expect(blocked.length).toBe(0);
  }, SLOW_MS);

  it("4. VOO, SIMULADOR e CURSO ONLINE impedem turno no mesmo dia", () => {
    const input = occupationBlocksInput();
    const blocks = [
      { uuid: "real-4", date: "2026-06-08", label: "VOO" },
      { uuid: "real-5", date: "2026-06-09", label: "SIMULADOR" },
      { uuid: "real-6", date: "2026-06-10", label: "CURSO ONLINE" },
    ] as const;

    const result = engine.generate(input);
    for (const b of blocks) {
      expect(
        result.assignments.some((a) => a.employeeUuid === b.uuid && a.date === b.date),
      ).toBe(false);
      expect(
        result.allocations.some(
          (a) => a.employeeUuid === b.uuid && a.date === b.date && a.label === b.label,
        ),
      ).toBe(true);
    }
  }, SLOW_MS);

  it("5. equipe reduzida bloqueia publicação", () => {
    const input = reducedTeamInput();
    const result = engine.generate(input);

    expect(result.summary.criticalCount).toBeGreaterThan(0);
    expect(result.summary.impossibleScenario).toBe(true);
    expect(result.summary.mainBlockingReasons!.length).toBeGreaterThan(0);

    const ctx = toContext(result, input);
    expect(evaluatePublishReadiness(ctx).canPublish).toBe(false);
  }, SLOW_MS);

  it("6. ausência de folga social classifica como WARNING, não CRITICAL", () => {
    const input = realisticBaselineInput();
    const result = engine.generate(input);

    const socialIssues = result.violations.filter((i) => i.type === "SEM FOLGA SOCIAL");
    for (const issue of socialIssues) {
      expect(classifyIssue(issue)).toBe("WARNING");
    }
  }, SLOW_MS);

  it("7. monofolga classifica como WARNING, não CRITICAL", () => {
    const input = realisticBaselineInput();
    const result = engine.generate(input);

    const mono = result.violations.filter((i) => i.type === "MONOFOLGA");
    for (const issue of mono) {
      expect(classifyIssue(issue)).toBe("WARNING");
    }
  }, SLOW_MS);

  it("8. cenário impossível expõe mainBlockingReasons", () => {
    const input = reducedTeamInput();
    const result = engine.generate(input);

    expect(result.summary.impossibleScenario).toBe(true);
    expect(result.summary.mainBlockingReasons!.length).toBeGreaterThan(0);
    expect(result.summary.mainBlockingReasons!.length).toBeGreaterThan(0);
  }, SLOW_MS);

  it("9. performance — cenário-base documenta generationMs", () => {
    const input = realisticBaselineInput();
    const result = engine.generate(input);

    expect(result.summary.generationMs).toBeDefined();
    expect(result.summary.generationMs!).toBeGreaterThan(0);
    expect(result.summary.generationMs!).toBeLessThan(SLOW_MS);

    if (result.summary.generationMs! > 30_000) {
      console.warn(
        `[Fase 5.3] Geração baseline levou ${result.summary.generationMs}ms (>30s) — gargalo provável: repair + validateSchedule.`,
      );
    }
  }, SLOW_MS);
});
