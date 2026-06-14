import { describe, expect, it } from "vitest";
import { addDays } from "../domain/rules/dates.js";
import { assignmentKey } from "../domain/schedule/types.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import {
  listIsolatedT8Entries,
  optimizeEmergencyIsolatedT8,
} from "../domain/schedule/optimize-emergency-isolated-t8.js";
import { validateNoCoverageGaps } from "../domain/schedule/repair-all-coverage-gaps-final.js";
import { validateFullShiftCoverage } from "../domain/schedule/workspace-optimization-transaction.js";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

function rebuildWorkspaceFromResult(
  input: ReturnType<typeof realisticGenerationInput>,
  result: ReturnType<typeof realScheduleEngine.generate>,
): GenerationWorkspace {
  const ws = new GenerationWorkspace(input);
  ws.applyHardBlocks();
  for (const a of result.assignments) {
    const did = ws.uuidToDomain.get(a.employeeUuid);
    if (did == null) continue;
    ws.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  for (const al of result.allocations) {
    ws.lockDay(al.employeeUuid, al.date, al.label, false);
  }
  ws.initRateioContext();
  for (const a of result.assignments) {
    if (a.shiftCode !== "T8") continue;
    const prev = addDays(a.date, -1);
    const next = addDays(a.date, 1);
    const prevT8 = result.assignments.some(
      (x) => x.employeeUuid === a.employeeUuid && x.date === prev && x.shiftCode === "T8",
    );
    const nextT8 = result.assignments.some(
      (x) => x.employeeUuid === a.employeeUuid && x.date === next && x.shiftCode === "T8",
    );
    if (!prevT8 && !nextT8) {
      ws.markEmergencyIsolatedT8(a.employeeUuid, a.date);
    }
  }
  return ws;
}

describe("optimizeEmergencyIsolatedT8", () => {
  it("pós-geração realística mantém gaps=0 e não aumenta isolados", () => {
    const input = realisticGenerationInput();
    const result = realScheduleEngine.generate(input);
    const ws = rebuildWorkspaceFromResult(input, result);

    expect(ws.listCoverageGaps()).toHaveLength(0);

    const beforeIsolated = listIsolatedT8Entries(ws).length;
    const opt = optimizeEmergencyIsolatedT8(ws, ws.rateioContext!);

    expect(ws.listCoverageGaps()).toHaveLength(0);
    expect(validateNoCoverageGaps(ws)).toHaveLength(0);
    expect(validateFullShiftCoverage(ws).ok).toBe(true);
    expect(opt.isolatedAfter).toBeLessThanOrEqual(beforeIsolated);
    if (opt.converted > 0) expect(opt.rolledBack).toBe(false);
  });

  it("segunda passagem é idempotente quanto a cobertura", () => {
    const input = realisticGenerationInput();
    const result = realScheduleEngine.generate(input);
    const ws = rebuildWorkspaceFromResult(input, result);

    optimizeEmergencyIsolatedT8(ws, ws.rateioContext!);
    const second = optimizeEmergencyIsolatedT8(ws, ws.rateioContext!);

    expect(ws.listCoverageGaps()).toHaveLength(0);
    expect(second.converted).toBe(0);
  });
});
