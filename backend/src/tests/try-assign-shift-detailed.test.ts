import { describe, expect, it } from "vitest";
import { materializeBlockPlans } from "../domain/schedule/demand-planning-materialize.js";
import { buildBlockPlans } from "../domain/schedule/demand-planning-blocks.js";
import type { IndividualTarget } from "../domain/schedule/demand-planning-types.js";
import { evaluateTryAssignShiftDetailed } from "../domain/schedule/try-assign-shift-detailed.js";
import {
  V3BlockMaterializeAuditCollector,
  formatV3BlockMaterializeDiscardTrace,
} from "../domain/schedule/v3-block-materialize-audit.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

function makeTarget(uuid: string, name: string, target: number): IndividualTarget {
  return {
    employeeUuid: uuid,
    name,
    group: "NORMAL",
    seniority: 1,
    target,
    capacity: target,
  };
}

describe("tryAssignShiftDetailed", () => {
  it("classifica DAY_OCCUPIED quando dia já tem turno", () => {
    const input = minimalPaoInput(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    const day = ws.days[0]!;
    ws.tryAssignShift(uuid, day, "T6");

    const diag = ws.tryAssignShiftDetailed(uuid, day, "T6");
    expect(diag.ok).toBe(false);
    expect(diag.reason).toBe("DAY_OCCUPIED");
  });

  it("classifica MIN_REST quando descanso 12h insuficiente", () => {
    const input = minimalPaoInput(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    const d0 = ws.days[0]!;
    const d1 = ws.days[1]!;
    ws.tryAssignShift(uuid, d0, "T8");
    ws.tryAssignShift(uuid, d1, "T8");

    const diag = ws.tryAssignShiftDetailed(uuid, d0, "T6");
    expect(diag.ok).toBe(false);
    expect(["MIN_REST", "CAN_WORK_FALSE", "DAY_OCCUPIED"]).toContain(diag.reason);
  });

  it("espelha evaluateTryAssignShiftDetailed via método do workspace", () => {
    const input = minimalPaoInput(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    const day = ws.days[10]!;
    expect(ws.tryAssignShiftDetailed(uuid, day, "T6")).toEqual(
      evaluateTryAssignShiftDetailed(ws, uuid, day, "T6"),
    );
  });
});

describe("V3 discard trace with tryAssignShift reason", () => {
  it("registra reason e details quando tryAssignShift falha após slot encontrado", () => {
    const input = minimalPaoInput(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    for (const day of ws.days) {
      if (day.endsWith("-01") || day.endsWith("-02") || day.endsWith("-04") || day.endsWith("-05")) {
        ws.lockDay(uuid, day, "FOLGA", false);
      }
    }
    const targets = [makeTarget(uuid, "PAO-Trace", 8)];
    const plans = buildBlockPlans(targets);
    const collector = new V3BlockMaterializeAuditCollector();
    materializeBlockPlans(ws, plans, { audit: collector });
    const report = collector.buildReport();
    const row = report.employees[0]!;

    const withAssignFailure = row.discarded.filter((d) =>
      d.tryPlaceBlockFailureStep?.includes("tryAssignShift"),
    );
    for (const d of withAssignFailure) {
      expect(d.tryAssignRejectReason).toBeDefined();
      expect(d.tryPlaceBlockFailureStep).toMatch(/tryAssignShift\(.+\) → false/);
    }

    const trace = formatV3BlockMaterializeDiscardTrace(report, ["PAO-Trace"]);
    expect(trace).toContain("reason");
  });
});
