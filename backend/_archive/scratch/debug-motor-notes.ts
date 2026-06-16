import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
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
const report = result.summary.realMotorReport as {
  stepNotes?: string[];
  warnings?: Array<{ type: string; detail: string }>;
};
console.log("coverageMissingCount", result.summary.coverageMissingCount);
console.log("gap notes", report.stepNotes?.filter((n) => n.includes("gap") || n.includes("[13]") || n.includes("[14]")));
console.log(
  "gap violations",
  report.warnings?.filter((w) => w.type.includes("COBERTURA") || w.detail.includes("furo")),
);
