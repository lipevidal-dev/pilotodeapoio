import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { buildWorkspaceFromGenerationResult } from "../../src/domain/schedule/schedule-generation-state.js";

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
console.log("T8 gaps:", ws.listCoverageGaps().filter((g) => g.shiftCode === "T8"));
console.log(
  "real-1 work",
  ws.workCount(uuid),
  "t6",
  ws.countShift(uuid, "T6"),
  "t7",
  ws.countShift(uuid, "T7"),
);
