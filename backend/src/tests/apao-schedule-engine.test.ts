import { describe, expect, it } from "vitest";
import { apaoScheduleEngine } from "../domain/schedule/apao-schedule-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

describe("Motor APAO dedicado", () => {
  it("gera turnos APAO com FA e respeita FP", () => {
    const input = realisticGenerationInput({
      approvedDayOff: [{ employeeUuid: "real-7", date: "2026-06-08" }],
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.coverPaoShiftsPrioritized();

    const report = apaoScheduleEngine.execute(ws);
    const apaoAssignments = apaoScheduleEngine.apaoAssignments(ws);
    const fa = ws.allocations.filter((a) => a.label === "FOLGA AGRUPADA");

    expect(report.assignmentsCreated).toBeGreaterThan(0);
    expect(apaoAssignments.length).toBeGreaterThan(0);
    expect(fa.length).toBeGreaterThanOrEqual(2);
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === "real-7" && a.date === "2026-06-08" && a.label === "FOLGA PEDIDA",
      ),
    ).toBe(true);
  });

  it("cada APAO recebe par FA quando possível", () => {
    const input = realisticGenerationInput();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.coverPaoShiftsPrioritized();
    apaoScheduleEngine.execute(ws);

    const apaoCount = input.employees.filter((e) => e.employee.role === "APAO").length;
    const faByApao = new Map<string, number>();
    for (const a of ws.allocations.filter((x) => x.label === "FOLGA AGRUPADA")) {
      faByApao.set(a.employeeUuid, (faByApao.get(a.employeeUuid) ?? 0) + 1);
    }
    for (const e of input.employees.filter((x) => x.employee.role === "APAO")) {
      expect(faByApao.get(e.uuid) ?? 0).toBeGreaterThanOrEqual(2);
    }
    expect(faByApao.size).toBe(apaoCount);
  });

  it("FA não cai no mesmo dia para dois APAOs", () => {
    const input = realisticGenerationInput();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.coverPaoShiftsPrioritized();
    apaoScheduleEngine.execute(ws);

    const byDate = new Map<string, number>();
    for (const a of ws.allocations.filter((x) => x.label === "FOLGA AGRUPADA")) {
      byDate.set(a.date, (byDate.get(a.date) ?? 0) + 1);
    }
    for (const [, count] of byDate) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});
