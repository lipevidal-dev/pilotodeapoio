import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { validateGenerationBeforeSave } from "../../src/domain/schedule/schedule-generation-validators.js";
import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";

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
const v = validateGenerationBeforeSave(input, result);
console.log("critical", v.criticalCount);
for (const i of v.issues) {
  if (i.level === "CRITICAL" || i.severity === "CRÍTICA") {
    console.log(i.type, i.date, i.detail?.slice(0, 150));
  }
}
const ws = buildWorkspaceFromGenerationResult(input, result);
console.log("rebuilt gaps", ws.listCoverageGaps());
console.log("result coverageMissing", result.summary.coverageMissingCount);
console.log(
  "15c",
  (result.summary.realMotorReport as { stepNotes?: string[] }).stepNotes?.find((n) => n.includes("[15c]")),
);
console.log(
  "T8 on 21/28",
  result.assignments.filter((a) => a.date === "2026-06-21" || a.date === "2026-06-28").map((a) => `${a.date} ${a.shiftCode} ${a.employeeUuid}`),
);
