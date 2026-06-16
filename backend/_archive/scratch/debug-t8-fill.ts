import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { repairAllCoverageGapsFinal } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";

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
const ctx = ws.ensureRateioContext();

for (const gapDay of ["2026-06-21", "2026-06-28"]) {
  console.log(`\n=== ${gapDay} ===`);
  console.log("has T8", ws.hasPaoCoverage(gapDay, "T8"));
  for (const c of ws.paoEmps) {
    const d = ws.tryAssignShiftDetailed(c.uuid, gapDay, "T8", true);
    if (!d.ok) {
      console.log(
        c.employee.name,
        d.reason,
        d.details?.slice(0, 80),
        "work",
        ws.workCount(c.uuid),
        "max",
        ctx.maxTurnCounts.get(c.uuid),
      );
    } else {
      console.log(c.employee.name, "OK emergency");
    }
  }
}

console.log("\nBefore repair gaps", ws.listCoverageGaps().length);
const audit = repairAllCoverageGapsFinal(ws, ctx);
console.log("After repair", audit, "gaps", ws.listCoverageGaps());
