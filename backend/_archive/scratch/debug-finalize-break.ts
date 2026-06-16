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

repairAllCoverageGapsFinal(scratch, scratch.rateioContext!);
scratch.clearCoverageGapsCache();
console.log("after repair before finalize", scratch.listCoverageGaps());
console.log("T8 21", scratch.findPaoOnShift("2026-06-21", "T8"));
console.log("emergency mark delta", scratch.isEmergencyIsolatedT8("real-4", "2026-06-21"));
finalizeT8NdBlocks(scratch);
scratch.clearCoverageGapsCache();
console.log("after finalize", scratch.listCoverageGaps());
console.log("T8 21", scratch.findPaoOnShift("2026-06-21", "T8"));
for (const c of scratch.paoEmps) {
  const d = scratch.tryAssignShiftDetailed(c.uuid, "2026-06-21", "T8", true);
  if (d.ok) console.log("can assign", c.employee.name);
  else console.log("blocked", c.employee.name, d.reason, d.details?.slice(0, 60));
}
