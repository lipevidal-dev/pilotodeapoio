import { RealScheduleEngine } from "../src/domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../src/domain/schedule/generation-workspace.js";
import { deduplicatePaoShiftCoverage } from "../src/domain/schedule/pao-shift-dedup.js";
import {
  repairT8GapsAfterDedup,
  tryRepairT8GapWithBlock,
} from "../src/domain/schedule/repair-t8-gaps-after-dedup.js";
import { realisticGenerationInput } from "../src/tests/realistic-fixtures.js";

const input = realisticGenerationInput();
const engine = new RealScheduleEngine();
const result = engine.generate(input);

console.log("=== RESULT ===");
console.log("gaps", result.summary.coverageMissingCount ?? result.summary.coverageGaps);
const seen = new Map<string, string[]>();
for (const a of result.assignments) {
  const k = `${a.date}|${a.shiftCode}`;
  (seen.get(k) ?? seen.set(k, []).get(k)!).push(a.employeeUuid);
}
for (const [k, v] of seen) {
  if (v.length > 1) console.log("dupe", k, v);
}

// Simulate post-optimizer state: manual replay with dedup+repair
console.log("\n=== SIMULATE REPAIR ONLY ===");
const ws = new GenerationWorkspace(input);
ws.applyHardBlocks();
for (const a of result.assignments) ws.seedAssignments([a]);
ws.initRateioContext();

const gapsBefore = ws.listCoverageGaps().filter((g) => g.shiftCode === "T8");
console.log("gaps before repair replay:", gapsBefore.map((g) => g.date));

for (const g of gapsBefore) {
  console.log(`tryRepair ${g.date}:`, tryRepairT8GapWithBlock(ws, g.date));
}

const audit = repairT8GapsAfterDedup(ws);
console.log("audit", audit);
console.log("gaps after", ws.listCoverageGaps().filter((g) => g.shiftCode === "T8"));
