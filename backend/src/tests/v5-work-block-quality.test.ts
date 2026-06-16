import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  findV58WorkBlocksForEmployee,
  listInvalidV58WorkBlocks,
  validateNoIsolatedWorkShifts,
  wouldCreateIsolatedWorkBlock,
} from "../domain/schedule/v5-work-block-quality.js";

function pao(id: number, seniority: number): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name: `PAO ${id}`, role: "PAO", seniority },
  };
}

function julyInput(employees: GenerationInputEmployee[]): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees,
    shifts: [
      { code: "T6", name: "T6", role: "PAO", active: true, startTime: "06:00", endTime: "14:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T7", name: "T7", role: "PAO", active: true, startTime: "14:00", endTime: "22:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T8", name: "T8", role: "PAO", active: true, startTime: "22:00", endTime: "06:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts: new Map([[1, new Set(["T6"])]]),
  };
}

describe("v5-work-block-quality", () => {
  it("guard bloqueia turno isolado e aceita bloco de 3 dias", () => {
    const ws = new GenerationWorkspace(julyInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v58WorkBlockGuardEnabled = true;

    const d0 = ws.days[0]!;
    const d1 = ws.days[1]!;
    const d2 = ws.days[2]!;

    expect(ws.tryAssignShift("pao-1", d0, "T6")).toBe(false);

    ws.v58WorkBlockGuardEnabled = false;
    expect(ws.tryAssignShift("pao-1", d0, "T6")).toBe(true);
    expect(ws.tryAssignShift("pao-1", d1, "T6")).toBe(true);
    expect(ws.tryAssignShift("pao-1", d2, "T6")).toBe(true);
    ws.v58WorkBlockGuardEnabled = true;

    const blocks = findV58WorkBlocksForEmployee(ws, "pao-1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.size).toBe(3);
    expect(listInvalidV58WorkBlocks(ws)).toHaveLength(0);
  });

  it("wouldCreateIsolatedWorkBlock detecta bloco de 1 e 2 dias", () => {
    const ws = new GenerationWorkspace(julyInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v58WorkBlockGuardEnabled = true;

    const day = ws.days[5]!;
    expect(wouldCreateIsolatedWorkBlock(ws, "pao-1", day, "T6", "assign")).toBe(true);

    ws.v58WorkBlockGuardEnabled = false;
    ws.tryAssignShift("pao-1", day, "T6");
    ws.v58WorkBlockGuardEnabled = true;
    const next = ws.days[ws.days.indexOf(day) + 1]!;
    expect(wouldCreateIsolatedWorkBlock(ws, "pao-1", next, "T6", "assign")).toBe(true);
  });

  it("validateNoIsolatedWorkShifts retorna CRITICAL para blocos inválidos", () => {
    const ws = new GenerationWorkspace(julyInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v58WorkBlockGuardEnabled = false;

    ws.tryAssignShift("pao-1", ws.days[0]!, "T6");
    ws.tryAssignShift("pao-1", ws.days[2]!, "T6");

    const issues = validateNoIsolatedWorkShifts(ws);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.level === "CRITICAL")).toBe(true);
    expect(issues[0]!.type).toBe("V58_ISOLATED_WORK_BLOCK");
  });

  it("bloqueia unassign que fragmentaria bloco válido", () => {
    const ws = new GenerationWorkspace(julyInput([pao(1, 1)]));
    ws.applyHardBlocks();
    ws.initRateioContext();
    ws.v58WorkBlockGuardEnabled = false;

    const d0 = ws.days[0]!;
    const d1 = ws.days[1]!;
    const d2 = ws.days[2]!;
    ws.tryAssignShift("pao-1", d0, "T6");
    ws.tryAssignShift("pao-1", d1, "T6");
    ws.tryAssignShift("pao-1", d2, "T6");

    ws.v58WorkBlockGuardEnabled = true;
    expect(ws.unassignShift("pao-1", d1)).toBe(false);
    expect(ws.v58WorkBlockAudit.some((e) => e.action === "unassignShift" && e.result === "BLOCKED")).toBe(true);
  });
});
