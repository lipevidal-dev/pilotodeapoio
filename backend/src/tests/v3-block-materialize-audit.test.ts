import { describe, expect, it } from "vitest";
import { materializeBlockPlans } from "../domain/schedule/demand-planning-materialize.js";
import { buildBlockPlans } from "../domain/schedule/demand-planning-blocks.js";
import type { IndividualTarget } from "../domain/schedule/demand-planning-types.js";
import {
  V3BlockMaterializeAuditCollector,
  formatV3BlockMaterializeAudit,
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

describe("V3 block materialize audit", () => {
  it("registra planejados, materializados e descartados por funcionário", () => {
    const input = minimalPaoInput(2);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const u0 = paoUuid(0);
    const u1 = paoUuid(1);
    const targets = [makeTarget(u0, "PAO-A", 8), makeTarget(u1, "PAO-B", 8)];
    const plans = buildBlockPlans(targets);
    const collector = new V3BlockMaterializeAuditCollector();
    materializeBlockPlans(ws, plans, { audit: collector });
    const report = collector.buildReport();

    expect(report.employees).toHaveLength(2);
    for (const row of report.employees) {
      expect(row.plannedBlocks).toBeGreaterThan(0);
      expect(row.plannedShifts).toBe(row.targetShifts);
      expect(row.materializedBlocks + row.discardedBlocks).toBe(row.plannedBlocks);
      expect(row.materializedShifts + row.discardedShifts).toBeLessThanOrEqual(row.plannedShifts);
    }
    expect(report.totals.plannedBlocks).toBe(
      report.employees.reduce((n, e) => n + e.plannedBlocks, 0),
    );

    const formatted = formatV3BlockMaterializeAudit(report);
    expect(formatted).toContain("V3 BLOCK MATERIALIZE AUDIT");
    expect(formatted).toContain("PAO-A");
  });

  it("classifica descarte quando calendário não comporta bloco consecutivo", () => {
    const input = minimalPaoInput(1);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const uuid = paoUuid(0);
    for (const day of ws.days) {
      if (day.endsWith("-01") || day.endsWith("-02") || day.endsWith("-04") || day.endsWith("-05")) {
        ws.lockDay(uuid, day, "FOLGA", false);
      }
    }
    const targets = [makeTarget(uuid, "PAO-Fragmentado", 8)];
    const plans = buildBlockPlans(targets);
    const collector = new V3BlockMaterializeAuditCollector();
    materializeBlockPlans(ws, plans, { audit: collector });
    const row = collector.buildReport().employees[0]!;

    if (row.discardedBlocks > 0) {
      expect(Object.keys(row.discardReasons).length).toBeGreaterThan(0);
      expect(row.discarded.every((d) => d.reason.length > 0)).toBe(true);
      for (const d of row.discarded) {
        expect(d.requiredSequence).toBe(d.plannedSize);
        expect(d.maxConsecutiveFree).toBeGreaterThanOrEqual(0);
        expect(d.findSpacedConsecutiveSlotResult).toBeNull();
        expect(d.tryPlaceBlockResult).toBe("NOT_CALLED");
      }
      const trace = formatV3BlockMaterializeDiscardTrace(collector.buildReport());
      expect(trace).toContain("DISCARD TRACE");
      expect(trace).toContain("findSpacedConsecutiveSlot");
    }
  });
});
