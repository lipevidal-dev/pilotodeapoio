import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { repairAllCoverageGapsFinal } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { finalizeT8NdBlocks } from "../../src/domain/schedule/schedule-grid-source.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";
import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { finalizeMinimumTurnTargetsForSave, enforceProportionalTurnTargets } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { allocateParallelShifts } from "../../src/domain/schedule/real-schedule-parallel.js";

const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
const input = realisticGenerationInput({
  noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
});
input.shiftRestrictions = new Map([[1, new Set(["T8"])]]);

const raw = new RealScheduleEngine().generate(input);
const ws = buildWorkspaceFromGenerationResult(input, raw);
const saveWs = finalizeMinimumTurnTargetsForSave(ws, input);
allocateParallelShifts(saveWs);
enforceProportionalTurnTargets(saveWs);

const scratch = new GenerationWorkspace(input);
scratch.applyHardBlocks();
for (const a of saveWs.toAssignments()) {
  const did = scratch.uuidToDomain.get(a.employeeUuid);
  if (did != null) scratch.planned.set(assignmentKey(did, a.date), a.shiftCode);
}
for (const al of saveWs.allocations) scratch.allocations.push({ ...al });
scratch.initRateioContext();

for (let i = 0; i < 4; i++) {
  repairAllCoverageGapsFinal(scratch, scratch.rateioContext!);
  finalizeT8NdBlocks(scratch);
  scratch.clearCoverageGapsCache();
  console.log(`pass ${i}`, scratch.listCoverageGaps());
  if (scratch.listCoverageGaps().length === 0) break;
}
