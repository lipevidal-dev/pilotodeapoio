import { ScheduleGenerationEngine } from "../src/domain/schedule/schedule-generation-engine.js";
import { realisticGenerationInput } from "../src/tests/realistic-fixtures.js";
import { filterByLevel } from "../src/domain/schedule/violation-level.js";

const r = new ScheduleGenerationEngine().generate(realisticGenerationInput());
for (const c of filterByLevel(r.violations, ["CRITICAL"])) {
  console.log(c.ruleCode, c.date, c.employee, c.detail);
}
console.log("summary", {
  critical: r.summary.criticalCount,
  gaps: r.summary.coverageMissingCount,
  daysFull: r.summary.daysWithFullCoverage,
  folgas: r.summary.folgasPerPao,
  valid: r.summary.valid,
});
