import { RealScheduleEngine } from "../src/domain/schedule/real-schedule-engine.js";
import { ScheduleGenerationEngine } from "../src/domain/schedule/schedule-generation-engine.js";
import { GenerationWorkspace } from "../src/domain/schedule/generation-workspace.js";
import { deduplicatePaoShiftCoverage } from "../src/domain/schedule/pao-shift-dedup.js";
import { filterByLevel } from "../src/domain/schedule/violation-level.js";
import { realisticGenerationInput } from "../src/tests/realistic-fixtures.js";
import { vacationSinglePao15DaysInput } from "../src/tests/hard-scenarios-fixtures.js";

console.log("===== DEDUP (REAL_V1 realistic) =====\n");
const realResult = new RealScheduleEngine().generate(realisticGenerationInput());
const seen = new Map<string, string[]>();
for (const a of realResult.assignments) {
  const key = `${a.date}|${a.shiftCode}`;
  const list = seen.get(key) ?? [];
  list.push(a.employeeUuid);
  seen.set(key, list);
}
const dupes = [...seen.entries()].filter(([, uuids]) => uuids.length > 1);
console.log(`Duplicatas: ${dupes.length}`);
for (const [key, uuids] of dupes) {
  console.log(`  ${key}: ${uuids.join(", ")}`);
}
const notes = (realResult.summary.realMotorReport as { stepNotes?: string[] })?.stepNotes ?? [];
console.log("\nStep notes dedup:");
for (const n of notes.filter((x) => x.includes("duplic") || x.includes("[12"))) {
  console.log(`  ${n}`);
}

console.log("\n===== VACATION 15d =====\n");
const vacInput = vacationSinglePao15DaysInput();
const alpha = vacInput.employees.find((e) => e.employee.name === "PAO Alpha")!.uuid;
const vacResult = new ScheduleGenerationEngine().generate(vacInput);
for (const a of vacResult.assignments.filter((x) => x.employeeUuid === alpha && x.date >= "2026-06-22" && x.date <= "2026-06-28")) {
  console.log(`shift ${a.date} ${a.shiftCode}`);
}
for (const al of vacResult.allocations.filter((x) => x.employeeUuid === alpha && x.date >= "2026-06-22" && x.date <= "2026-06-28")) {
  console.log(`alloc ${al.date} ${al.label}`);
}
const critical = filterByLevel(vacResult.violations, ["CRITICAL"]);
for (const c of critical.filter((x) => x.ruleCode === "TURNO EM DIA ND" || x.ruleCode.includes("T8") || x.ruleCode.includes("ND"))) {
  console.log(`violation ${c.ruleCode} ${c.date} ${c.detail}`);
}

console.log("\n===== Dedup after manual replay =====\n");
const ws = new GenerationWorkspace(realisticGenerationInput());
ws.applyHardBlocks();
for (const a of realResult.assignments) {
  ws.seedAssignments([a]);
}
const extra = deduplicatePaoShiftCoverage(ws);
console.log(`extra removed on replay: ${extra}`);
for (const [key, uuids] of dupes) {
  const [day, code] = key.split("|") as [string, string];
  for (const uuid of uuids.slice(1)) {
    const protected_ = (ws as unknown as { isT8BlockProtected: (u: string, d: string) => boolean }).isT8BlockProtected?.(uuid, day);
    console.log(`  unassign ${uuid} ${day} ${code} protected=${protected_}`);
  }
}
