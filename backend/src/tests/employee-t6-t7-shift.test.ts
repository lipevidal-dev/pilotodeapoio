import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { materializeBlockPlans } from "../domain/schedule/demand-planning-materialize.js";
import { buildBlockPlans } from "../domain/schedule/demand-planning-blocks.js";
import { resolveEmployeeT6T7Code } from "../domain/schedule/employee-t6-t7-shift.js";
import { buildPreferredShiftMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { minimalPaoInput } from "./generation-fixtures.js";

function paoUuid(index: number): string {
  return `uuid-${index + 1}`;
}

describe("employee-t6-t7-shift", () => {
  it("funcionário com preferência T7 recebe somente T7 nos blocos", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(1);
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: uuid, shiftCode: "T7" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    expect(resolveEmployeeT6T7Code(ws, uuid, ws.days.slice(0, 4))).toBe("T7");

    const targets = [
      {
        employeeUuid: uuid,
        name: "PAO 2",
        group: "NORMAL" as const,
        seniority: 2,
        target: 8,
        capacity: 20,
      },
    ];
    const plans = buildBlockPlans(targets);
    materializeBlockPlans(ws, plans);

    const codes = new Set(
      ws.toAssignments().filter((a) => a.employeeUuid === uuid).map((a) => a.shiftCode),
    );
    expect(codes.has("T6")).toBe(false);
    expect(codes.has("T7")).toBe(true);
  });

  it("funcionário mantém mesmo turno T6 em todos os blocos materializados", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    input.shiftRestrictions = new Map([
      [input.employees.find((e) => e.uuid === uuid)!.domainId, new Set(["T7"])],
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    const targets = [
      {
        employeeUuid: uuid,
        name: "PAO 1",
        group: "NORMAL" as const,
        seniority: 1,
        target: 12,
        capacity: 20,
      },
    ];
    materializeBlockPlans(ws, buildBlockPlans(targets));

    const t6 = ws.toAssignments().filter((a) => a.employeeUuid === uuid && a.shiftCode === "T6");
    const t7 = ws.toAssignments().filter((a) => a.employeeUuid === uuid && a.shiftCode === "T7");
    expect(t6.length).toBeGreaterThan(0);
    expect(t7.length).toBe(0);
  });
});
