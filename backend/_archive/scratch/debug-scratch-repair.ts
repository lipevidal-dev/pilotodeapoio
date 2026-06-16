import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { repairAllCoverageGapsFinal } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { finalizeT8NdBlocks } from "../../src/domain/schedule/schedule-grid-source.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";
import { enforceProportionalTurnTargets } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { finalizeMinimumTurnTargetsForSave } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { allocateParallelShifts } from "../../src/domain/schedule/real-schedule-parallel.js";

const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => {
  const d = String(i + 1).padStart(2, "0");
  return `2026-06-${d}`;
});
const input = realisticGenerationInput({
  noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
});
input.shiftRestrictions = new Map([[1, new Set(["T8"])]]);

// Simulate pre-save state: generate then rebuild without [15c]
const raw = new RealScheduleEngine().generate(input);
const ws = buildWorkspaceFromGenerationResult(input, raw);
console.log("from result gaps", ws.listCoverageGaps());

// simulate finalize path - we need ws before save from engine... use result assignments as baseline
const saveWs = finalizeMinimumTurnTargetsForSave(ws, input);
allocateParallelShifts(saveWs);
enforceProportionalTurnTargets(saveWs);
saveWs.clearCoverageGapsCache();
console.log("pre-repair gaps", saveWs.listCoverageGaps());

const scratch = new GenerationWorkspace(input);
scratch.applyHardBlocks();
for (const a of saveWs.toAssignments()) {
  const did = scratch.uuidToDomain.get(a.employeeUuid);
  if (did != null) scratch.planned.set(assignmentKey(did, a.date), a.shiftCode);
}
for (const al of saveWs.allocations) scratch.allocations.push({ ...al });
scratch.initRateioContext();
console.log("scratch before repair", scratch.listCoverageGaps());
const audit = repairAllCoverageGapsFinal(scratch, scratch.rateioContext!);
finalizeT8NdBlocks(scratch);
console.log("scratch after repair", audit, scratch.listCoverageGaps());
