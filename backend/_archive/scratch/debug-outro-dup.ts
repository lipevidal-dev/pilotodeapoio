import { ScheduleGenerationEngine } from "../../src/domain/schedule/schedule-generation-engine.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";

const input = realisticGenerationInput({
  lockedAllocations: [{ employeeUuid: "real-5", date: "2026-06-14", label: "OUTRO" }],
});
const result = new ScheduleGenerationEngine().generate(input);
const uuid = "real-5";
const day = "2026-06-14";
console.log(
  "allocations",
  result.allocations.filter((a) => a.employeeUuid === uuid && a.date === day),
);
console.log(
  "assignments",
  result.assignments.filter((a) => a.employeeUuid === uuid && a.date === day),
);
