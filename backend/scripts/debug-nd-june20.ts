import { RealScheduleEngine } from "../src/domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../src/domain/schedule/generation-workspace.js";
import { minimalPaoInput } from "../src/tests/generation-fixtures.js";
import { hasNdOnGrid, isNdPlacementBlocked } from "../src/domain/schedule/schedule-grid-source.js";

const input = minimalPaoInput(4);
const result = new RealScheduleEngine().generate(input);
const ws = new GenerationWorkspace(input);
ws.applyHardBlocks();
for (const a of result.assignments) {
  const did = ws.uuidToDomain.get(a.employeeUuid)!;
  ws.planned.set(`${did}|${a.date}`, a.shiftCode);
}
for (const al of result.allocations) {
  ws.lockDay(al.employeeUuid, al.date, al.label, false);
}

const uuid = "uuid-2";
const did = ws.uuidToDomain.get(uuid)!;
for (const day of ["2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21"]) {
  console.log(day, {
    shift: ws.planned.get(`${did}|${day}`),
    blocked: ws.blocked.get(`${did}|${day}`),
    allocs: result.allocations.filter((a) => a.employeeUuid === uuid && a.date === day),
  });
}
console.log("hasNd 20", hasNdOnGrid(ws, uuid, "2026-06-20"));
console.log("blocked placement", isNdPlacementBlocked(ws, uuid, "2026-06-20"));
