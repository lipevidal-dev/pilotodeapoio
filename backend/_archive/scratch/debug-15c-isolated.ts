import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { repairCoverageGapsBeforeSave } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { validateGenerationBeforeSave } from "../../src/domain/schedule/schedule-generation-validators.js";
import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { finalizeMinimumTurnTargetsForSave, enforceProportionalTurnTargets } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { allocateParallelShifts } from "../../src/domain/schedule/real-schedule-parallel.js";

const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
const input = realisticGenerationInput({
  noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
});
input.shiftRestrictions = new Map([[1, new Set(["T8"])]]);

// Simulate ws at [15c] without running broken merge: use engine output before 15c
// Approximate: generate, rebuild, finalize path
const raw = new RealScheduleEngine().generate(input);
const { buildWorkspaceFromGenerationResult } = await import("../../src/domain/schedule/schedule-generation-state.js");
let ws = buildWorkspaceFromGenerationResult(input, raw);

// If raw already has 15c, gaps might be wrong. Check raw gaps
console.log("raw result gaps from assignments rebuild", ws.listCoverageGaps().length);

ws = finalizeMinimumTurnTargetsForSave(ws, input);
allocateParallelShifts(ws);
enforceProportionalTurnTargets(ws);
ws.clearCoverageGapsCache();
console.log("pre 15c gaps", ws.listCoverageGaps());

const audit = repairCoverageGapsBeforeSave(ws);
console.log("audit", audit);
console.log("post 15c gaps", ws.listCoverageGaps());

const fakeResult = {
  assignments: ws.toAssignments(),
  allocations: ws.allocations,
  violations: [],
  summary: raw.summary,
  success: true,
  suggestions: [],
};
const v = validateGenerationBeforeSave(input, fakeResult as never);
console.log("validation critical", v.criticalCount);
for (const i of v.issues.filter((x) => x.level === "CRITICAL")) console.log(i.type, i.date, i.detail?.slice(0, 80));
