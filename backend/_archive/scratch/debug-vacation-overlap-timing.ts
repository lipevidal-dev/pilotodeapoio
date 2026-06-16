import { ScheduleGenerationEngine } from "../../src/domain/schedule/schedule-generation-engine.js";
import { vacationTwoPaoOverlapInput } from "../../src/tests/hard-scenarios-fixtures.js";

const t0 = performance.now();
const result = new ScheduleGenerationEngine().generate(vacationTwoPaoOverlapInput());
console.log("ms", Math.round(performance.now() - t0));
console.log("gaps", result.summary.coverageMissingCount, "critical", result.summary.criticalCount);
