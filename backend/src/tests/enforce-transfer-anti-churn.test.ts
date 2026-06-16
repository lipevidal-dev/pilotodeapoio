import { describe, expect, it } from "vitest";
import { enforceTargetTurnTargets } from "../domain/schedule/enforce-minimum-turn-targets.js";
import { V4TransferAuditCollector } from "../domain/schedule/v4-transfer-audit.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { assignmentKey } from "../domain/schedule/types.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

const DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function assign(ws: GenerationWorkspace, uuid: string, day: string, code: string): void {
  const did = ws.uuidToDomain.get(uuid)!;
  ws.planned.set(assignmentKey(did, day), code);
}

describe("enforce transfer anti-churn", () => {
  it("fase target não estoura 2000 passes em grade desbalanceada", () => {
    const input = minimalPaoInput(4);
    const ids = [paoUuid(0), paoUuid(1), paoUuid(2), paoUuid(3)];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();

    for (let i = 0; i < DAYS.length; i++) {
      const day = DAYS[i]!;
      assign(ws, ids[3]!, day, "T6");
      assign(ws, ids[1]!, day, "T7");
      assign(ws, ids[2]!, day, "T8");
    }

    ws.initRateioContext();
    ws.syncRateioContext();

    const collector = new V4TransferAuditCollector();
    const report = enforceTargetTurnTargets(ws, { audit: collector, phase: "target" });
    const audit = collector.buildPhaseAudit("target", {
      belowMinBefore: 0,
      belowMinAfter: 0,
      belowTargetBefore: 1,
      belowTargetAfter: 0,
    });

    expect(report.transfers).toBeLessThan(200);
    expect(audit.attemptsTotal).toBeLessThan(500);
  });
});
