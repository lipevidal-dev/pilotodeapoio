import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { filterByLevel } from "../domain/schedule/violation-level.js";
import { issueToApiViolation } from "../infrastructure/mappers/violation.mapper.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const engine = new ScheduleGenerationEngine();

describe("Consistência API de violações", () => {
  it("violations[].severity coincide com summary critical/warning/info counts", () => {
    const generated = engine.generate(realisticGenerationInput());
    const apiViolations = generated.violations.map(issueToApiViolation);

    const critical = apiViolations.filter((v) => v.severity === "CRITICAL").length;
    const warning = apiViolations.filter((v) => v.severity === "WARNING").length;
    const info = apiViolations.filter((v) => v.severity === "INFO").length;

    expect(critical).toBe(generated.summary.criticalCount);
    expect(warning).toBe(generated.summary.warningCount);
    expect(info).toBe(generated.summary.infoCount);
    expect(apiViolations.length).toBe(generated.summary.totalViolations);
  });

  it("issueToApiViolation usa nível classificado, não severity legado em português", () => {
    const generated = engine.generate(realisticGenerationInput());
    const warnings = filterByLevel(generated.violations, ["WARNING"]);
    if (warnings.length === 0) return;

    const api = issueToApiViolation(generated.violations[0]);
    expect(["CRITICAL", "WARNING", "INFO"]).toContain(api.severity);
    expect(["CRÍTICA", "ALTA", "MÉDIA", "BAIXA"]).not.toContain(api.severity);
  });
});
