import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import {
  enforceMinimumTurnTargets,
  enforceProportionalTurnTargets,
} from "../domain/schedule/enforce-minimum-turn-targets.js";
import { assignmentKey } from "../domain/schedule/types.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function assign(ws: GenerationWorkspace, uuid: string, day: string, code: string): void {
  const did = ws.uuidToDomain.get(uuid)!;
  ws.planned.set(assignmentKey(did, day), code);
}

describe("enforceMinimumTurnTargets", () => {
  it("preserva cobertura completa em grade equilibrada", () => {
    const input = minimalPaoInput(4);
    const ids = [paoUuid(0), paoUuid(1), paoUuid(2), paoUuid(3)];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    for (let i = 0; i < MONTH_DAYS.length; i++) {
      const day = MONTH_DAYS[i]!;
      assign(ws, ids[i % 4]!, day, "T6");
      assign(ws, ids[(i + 1) % 4]!, day, "T7");
      assign(ws, ids[(i + 2) % 4]!, day, "T8");
    }

    ws.initRateioContext();
    enforceProportionalTurnTargets(ws);
    ws.syncRateioContext();

    expect(ws.listCoverageGaps().length).toBe(0);
    for (const id of ids) {
      const min = ws.rateioContext!.minTurnCounts.get(id) ?? 0;
      expect(ws.rateioContext!.currentTurnCounts.get(id) ?? 0).toBeGreaterThanOrEqual(min);
    }
  });

  it("transfere T6 de doador acima do target para receptor abaixo do mínimo", () => {
    const input = minimalPaoInput(4);
    const donor = paoUuid(3);
    const receiver = paoUuid(0);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    for (const day of MONTH_DAYS) {
      assign(ws, donor, day, "T6");
      assign(ws, paoUuid(1), day, "T7");
      assign(ws, paoUuid(2), day, "T8");
    }

    ws.initRateioContext();
    ws.syncRateioContext();

    const ctx = ws.rateioContext!;
    const beforeReceiver = ctx.currentTurnCounts.get(receiver) ?? 0;
    const minReceiver = ctx.minTurnCounts.get(receiver)!;

    expect(beforeReceiver).toBe(0);
    expect(beforeReceiver).toBeLessThan(minReceiver);
    expect(ctx.currentTurnCounts.get(donor) ?? 0).toBeGreaterThan(ctx.targetTurnCounts.get(donor)!);

    const report = enforceMinimumTurnTargets(ws);
    ws.syncRateioContext();

    expect(report.transfers).toBeGreaterThan(0);
    expect(ctx.currentTurnCounts.get(receiver) ?? 0).toBeGreaterThan(beforeReceiver);
  });
});
