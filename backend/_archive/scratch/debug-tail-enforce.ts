import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { repairAllCoverageGapsFinal } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { enforceProportionalTurnTargets } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { finalizeT8NdBlocks } from "../../src/domain/schedule/finalize-t8-nd-blocks.js";

const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => {
  const d = String(i + 1).padStart(2, "0");
  return `2026-06-${d}`;
});
const input = realisticGenerationInput({
  noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
});
input.shiftRestrictions = new Map([[1, new Set(["T8"])]]);

const result = new RealScheduleEngine().generate(input);
const ws = buildWorkspaceFromGenerationResult(input, result);
console.log("Initial gaps", ws.listCoverageGaps());

const ctx = ws.ensureRateioContext();
repairAllCoverageGapsFinal(ws, ctx);
finalizeT8NdBlocks(ws);
ws.syncRateioContext();
console.log("After repair1", ws.listCoverageGaps().length);

enforceProportionalTurnTargets(ws);
console.log("After enforce", ws.listCoverageGaps());

repairAllCoverageGapsFinal(ws, ctx);
finalizeT8NdBlocks(ws);
console.log("After repair2", ws.listCoverageGaps().length);
