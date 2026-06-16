import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { repairAllCoverageGapsFinal } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";
import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { finalizeMinimumTurnTargetsForSave, enforceProportionalTurnTargets } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { allocateParallelShifts } from "../../src/domain/schedule/real-schedule-parallel.js";
import { addDays } from "../../src/domain/rules/dates.js";

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

for (const c of scratch.paoEmps) {
  for (const d of ["2026-06-19", "2026-06-20", "2026-06-21", "2026-06-22"]) {
    const sh = scratch.shiftOnDay(c.domainId, d);
    if (sh) console.log(c.employee.name, d, sh);
  }
}

function isNdSlotAfterOwnT8Pair(ws: GenerationWorkspace, empUuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(empUuid);
  if (!did) return false;
  const d2 = addDays(day, -1);
  const d1 = addDays(day, -2);
  return ws.shiftOnDay(did, d1) === "T8" && ws.shiftOnDay(did, d2) === "T8";
}

console.log("delta 21 is nd slot", isNdSlotAfterOwnT8Pair(scratch, "real-4", "2026-06-21"));
