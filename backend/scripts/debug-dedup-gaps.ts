import { RealScheduleEngine } from "../src/domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../src/domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "../src/tests/realistic-fixtures.js";

const result = new RealScheduleEngine().generate(realisticGenerationInput());
const ws = new GenerationWorkspace(realisticGenerationInput());
ws.applyHardBlocks();
for (const a of result.assignments) {
  ws.seedAssignments([a]);
}

const gaps = ws.listCoverageGaps();
console.log(`coverageGaps: ${gaps.length}`);
for (const g of gaps) {
  console.log(`  ${g.date} ${g.shiftCode}`);
}

const notes = (result.summary.realMotorReport as { stepNotes?: string[] })?.stepNotes ?? [];
for (const n of notes.filter((x) => x.includes("[12"))) {
  console.log(n);
}
