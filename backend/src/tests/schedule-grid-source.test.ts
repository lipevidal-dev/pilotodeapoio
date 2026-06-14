import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import {
  auditT8NdFromGridSource,
  hasNdOnGrid,
} from "../domain/schedule/schedule-grid-source.js";
import { minimalPaoInput } from "./generation-fixtures.js";

describe("schedule-grid-source — T8/T8/ND", () => {
  it("ND gerado aparece na fonte da grade (blocked + allocations)", () => {
    const ws = new GenerationWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.tryPlaceT8Block(ws.paoEmps[0]!.uuid, "2026-06-10");

    expect(hasNdOnGrid(ws, ws.paoEmps[0]!.uuid, "2026-06-12")).toBe(true);
    const audit = auditT8NdFromGridSource(ws);
    expect(audit.pairsWithoutNdCount).toBe(0);
  });

  it("ND substitui folga social gerada no dia pós T8/T8", () => {
    const ws = new GenerationWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    const uuid = ws.paoEmps[1]!.uuid;
    ws.tryAssignShift(uuid, "2026-06-18", "T8");
    ws.tryAssignShift(uuid, "2026-06-19", "T8");
    ws.lockDay(uuid, "2026-06-20", "FOLGA SOCIAL");

    ws.ensureNdForT8Pairs();

    expect(hasNdOnGrid(ws, uuid, "2026-06-20")).toBe(true);
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === uuid && a.date === "2026-06-20" && a.label === "ND",
      ),
    ).toBe(true);
    expect(auditT8NdFromGridSource(ws).pairsWithoutNdCount).toBe(0);
  });

  it("motor REAL_V1 finaliza com 0 pares T8/T8 sem ND in-month", () => {
    const result = new RealScheduleEngine().generate(minimalPaoInput(4));
    const ws = new GenerationWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    for (const a of result.assignments) {
      const did = ws.uuidToDomain.get(a.employeeUuid)!;
      ws.planned.set(`${did}|${a.date}`, a.shiftCode);
    }
    for (const al of result.allocations) {
      ws.lockDay(al.employeeUuid, al.date, al.label, false);
    }
    const audit = auditT8NdFromGridSource(ws);
    expect(audit.pairsWithoutNdCount).toBe(0);
  });
});
