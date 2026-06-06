import { describe, expect, it } from "vitest";
import { canWork } from "../../domain/rules/eligibility.js";
import { buildShiftMap } from "../../domain/shift/default-shifts.js";
import { MOCK_EMPLOYEES } from "../fixtures.js";
import { assignmentKey, type BlockedMap, type PlannedMap } from "../../domain/schedule/types.js";
import { buildShiftRestrictionMap } from "../../infrastructure/mappers/generation-input.mapper.js";
import {
  freshWorkspace,
  minimalPaoInput,
  paoUuid,
  realisticGenerationInput,
  realPaoUuid,
} from "./slice-helpers.js";

const shiftMap = buildShiftMap();
const roleMap = new Map(MOCK_EMPLOYEES.map((e) => [e.id, e.role]));

function planned(entries: [number, string, string][]): PlannedMap {
  const m: PlannedMap = new Map();
  for (const [eid, day, code] of entries) m.set(assignmentKey(eid, day), code);
  return m;
}

function blocked(entries: [number, string, string][]): BlockedMap {
  const m: BlockedMap = new Map();
  for (const [eid, day, type] of entries) m.set(assignmentKey(eid, day), type);
  return m;
}

describe("Fatia 3 — Eligibility / canWork", () => {
  it("descanso 12h impede turno no dia seguinte a T8", () => {
    const pao = MOCK_EMPLOYEES[0];
    const plan = planned([[1, "2026-06-09", "T8"]]);
    const r = canWork(pao, "2026-06-10", "T6", blocked([]), plan, { shiftMap, roleByEmployeeId: roleMap });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/12h|descanso/i);
  });

  it("shift restriction impede turno bloqueado no workspace", () => {
    const input = minimalPaoInput(2);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T6" },
    ]);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T6")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T7")).toBe(true);
  });

  it("limite de 2 simultâneos rejeita terceiro PAO no mesmo turno", () => {
    const pao = MOCK_EMPLOYEES[0];
    const plan = planned([
      [2, "2026-06-10", "T6"],
      [3, "2026-06-10", "T6"],
    ]);
    const r = canWork(pao, "2026-06-10", "T6", blocked([]), plan, { shiftMap, roleByEmployeeId: roleMap });
    expect(r.ok).toBe(false);
  });

  it("APAO sem PAO no intervalo é rejeitado", () => {
    const apao = MOCK_EMPLOYEES.find((e) => e.role === "APAO")!;
    const r = canWork(apao, "2026-06-10", "T2", blocked([]), planned([]), {
      shiftMap,
      roleByEmployeeId: roleMap,
    });
    expect(r.ok).toBe(false);
  });

  it("APAO com PAO cobrindo intervalo é aceito", () => {
    const apao = MOCK_EMPLOYEES.find((e) => e.role === "APAO")!;
    const plan = planned([[1, "2026-06-10", "T6"]]);
    const r = canWork(apao, "2026-06-10", "T2", blocked([]), plan, { shiftMap, roleByEmployeeId: roleMap });
    expect(r.ok).toBe(true);
  });

  it("dia bloqueado por férias impede tryAssignShift", () => {
    const input = minimalPaoInput(2);
    input.vacationDays = [{ employeeUuid: paoUuid(0), date: "2026-06-12" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-12", "T6")).toBe(false);
  });

  it("elegibilidade após T8: ND bloqueado impede novo turno no mesmo dia", () => {
    const input = realisticGenerationInput();
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    ws.tryPlaceT8Block(realPaoUuid(0), "2026-06-05");
    const ndDay = "2026-06-07";
    expect(ws.isDayBlockedForShift(realPaoUuid(0), ndDay)).toBe(true);
    expect(ws.tryAssignShift(realPaoUuid(0), ndDay, "T6")).toBe(false);
  });
});
