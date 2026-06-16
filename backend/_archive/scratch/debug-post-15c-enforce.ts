import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { validateGenerationBeforeSave } from "../../src/domain/schedule/schedule-generation-validators.js";
import {
  buildGenerationInput,
} from "../../src/infrastructure/mappers/generation-input.mapper.js";
import {
  mockPrismaEmployeesFromRealistic,
  mockPrismaRoles,
  mockPrismaShifts,
} from "../../src/tests/helpers/generate-schedule-mocks.js";
import { repairCoverageGapsBeforeSave } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { enforceProportionalTurnTargets, enforceMinimumTurnTargets } from "../../src/domain/schedule/enforce-minimum-turn-targets.js";
import { validateRateioMinimums } from "../../src/domain/schedule/rateio-minimum-validation.js";
import { repairAllCoverageGapsFinal } from "../../src/domain/schedule/repair-all-coverage-gaps-final.js";
import { finalizeT8NdBlocks } from "../../src/domain/schedule/schedule-grid-source.js";
import { assignmentKey } from "../../src/domain/schedule/types.js";
import { finalizeMinimumTurnTargetsForSave } from "../../src/domain/schedule/finalize-minimum-turn-targets-for-save.js";
import { allocateParallelShifts } from "../../src/domain/schedule/allocate-parallel-shifts.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { RealScheduleEngine as Engine } from "../../src/domain/schedule/real-schedule-engine.js";

// replicate engine tail without full generate - use internal execute via copy
const uuid = "real-1";
const days = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
const employees = mockPrismaEmployeesFromRealistic();
const input = buildGenerationInput({
  year: 2026, month: 6, employees, shifts: mockPrismaShifts(), roles: mockPrismaRoles(),
  lockedAllocations: [], vacationDays: [], vacationReturnDays: [], crossMonthHistory: undefined,
  shiftRestrictionRows: [{ employeeUuid: uuid, shiftCode: "T8" }],
  preferredShiftRows: [], noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
  approvedDayOff: [], flightDays: [],
});

const engine = new RealScheduleEngine();
const result = engine.generate(input);
console.log("before fix critical:", validateGenerationBeforeSave(input, result).criticalCount);

// simulate post-15c enforce on rebuilt ws
const ws = new GenerationWorkspace(input);
ws.applyHardBlocks();
for (const a of result.assignments) {
  const did = ws.uuidToDomain.get(a.employeeUuid);
  if (did != null) ws.planned.set(assignmentKey(did, a.date), a.shiftCode);
}
ws.allocations.push(...result.allocations.map((a) => ({ ...a })));
ws.initRateioContext();
ws.syncRateioContext();

enforceProportionalTurnTargets(ws);
for (let clamp = 0; clamp < 32; clamp++) {
  if (!validateRateioMinimums(ws).issues.some((i) => i.hasValidTransfer)) break;
  const r = enforceMinimumTurnTargets(ws);
  ws.syncRateioContext();
  console.log("clamp", clamp, "transfers", r.transfers);
  if (r.transfers === 0) break;
}
ws.clearCoverageGapsCache();
console.log("gaps after enforce:", ws.listCoverageGaps().length);
console.log("min issues:", validateRateioMinimums(ws).issues.filter(i => i.hasValidTransfer).map(i => i.name));

if (ws.listCoverageGaps().length > 0) {
  repairAllCoverageGapsFinal(ws, ws.ensureRateioContext());
  finalizeT8NdBlocks(ws);
  ws.syncRateioContext();
  console.log("gaps after repair:", ws.listCoverageGaps().length);
}
