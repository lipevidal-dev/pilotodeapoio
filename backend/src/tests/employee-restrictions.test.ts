import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Employee, Role } from "@prisma/client";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { ScheduleRepairEngine } from "../domain/schedule/schedule-repair-engine.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { dedupeIsoDates } from "../domain/employee/restrictions.js";
import { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";
import { minimalPaoInput } from "./generation-fixtures.js";

const rolePao: Role = {
  id: "role-pao",
  name: "PAO",
  code: "PAO",
  description: null,
  active: true,
  displayOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function paoUuid(i = 0): string {
  return `uuid-${i + 1}`;
}

describe("dedupeIsoDates", () => {
  it("remove datas duplicadas", () => {
    expect(dedupeIsoDates(["2026-06-01", "2026-06-01", "2026-06-02"])).toEqual([
      "2026-06-01",
      "2026-06-02",
    ]);
  });
});

describe("EmployeeUseCase — restrições", () => {
  const create = vi.fn();
  const update = vi.fn();
  const findById = vi.fn();
  const empRepo = {
    findAll: vi.fn(),
    findById,
    create,
    update,
    countOperationalHistory: vi.fn(),
    delete: vi.fn(),
  } as unknown as EmployeeRepository;

  const roleRepo = {
    findById: vi.fn().mockResolvedValue(rolePao),
    findByCode: vi.fn(),
  } as unknown as RoleRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("criar funcionário com restrições de voo e turno", async () => {
    create.mockResolvedValue({
      id: "emp-1",
      name: "PAO Test",
      type: "PAO",
      roleId: rolePao.id,
      seniorityNumber: 1,
      active: true,
      birthDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: rolePao,
      flightRestrictions: [{ date: new Date("2026-06-10"), employeeId: "emp-1", id: "f1", notes: null, createdAt: new Date(), updatedAt: new Date() }],
      shiftRestrictions: [{ shiftId: "shift-t6", employeeId: "emp-1", id: "s1", createdAt: new Date(), updatedAt: new Date(), shift: { id: "shift-t6", code: "T6", name: "T6", startTime: "06:00", endTime: "12:00", durationHours: 6, employeeTypeAllowed: "PAO", active: true, displayOrder: 1, mandatoryCoverage: true, requiresT8PairNd: false, createdAt: new Date(), updatedAt: new Date() } }],
    });

    await new EmployeeUseCase(empRepo, roleRepo).create({
      name: "PAO Test",
      roleId: rolePao.id,
      noFlightDates: ["2026-06-10"],
      restrictedShiftIds: ["shift-t6"],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        noFlightDates: ["2026-06-10"],
        restrictedShiftIds: ["shift-t6"],
      }),
    );
  });

  it("editar restrições repassa ao repositório", async () => {
    findById.mockResolvedValue({ id: "emp-1", type: "PAO", seniorityNumber: 1 } as Employee);
    update.mockResolvedValue({
      id: "emp-1",
      name: "PAO Test",
      type: "PAO",
      roleId: rolePao.id,
      seniorityNumber: 1,
      active: true,
      birthDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: rolePao,
      flightRestrictions: [],
      shiftRestrictions: [],
    });

    await new EmployeeUseCase(empRepo, roleRepo).update("emp-1", {
      noFlightDates: ["2026-06-11"],
      restrictedShiftIds: ["shift-t8"],
    });

    expect(update).toHaveBeenCalledWith(
      "emp-1",
      expect.objectContaining({
        noFlightDates: ["2026-06-11"],
        restrictedShiftIds: ["shift-t8"],
      }),
    );
  });
});

describe("Motor — restrição de turno", () => {
  it("não aloca turno restrito", () => {
    const input = minimalPaoInput(2);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T8" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T8")).toBe(false);
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T6")).toBe(true);
  });

  it("repair engine não viola turno restrito", () => {
    const input = minimalPaoInput(3);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T6" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.tryAssignShift(paoUuid(1), "2026-06-10", "T7");
    ws.tryAssignShift(paoUuid(2), "2026-06-10", "T8");
    new ScheduleRepairEngine().repair(ws, []);
    expect(ws.toAssignments().some((a) => a.employeeUuid === paoUuid(0) && a.shiftCode === "T6")).toBe(false);
  });
});

describe("Motor — não alocar voos", () => {
  it("applyFlightsToAvailablePaoDays ignora dia com restrição de voo", () => {
    const input = minimalPaoInput(1);
    input.noFlightDates = [{ employeeUuid: paoUuid(0), date: "2026-06-10" }];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const created = ws.applyFlightsToAvailablePaoDays();
    expect(created.some((a) => a.employeeUuid === paoUuid(0) && a.date === "2026-06-10")).toBe(false);
    expect(created.some((a) => a.employeeUuid === paoUuid(0))).toBe(true);
  });

  it("restrição de voo não impede turno no mesmo dia", () => {
    const input = minimalPaoInput(1);
    input.noFlightDates = [{ employeeUuid: paoUuid(0), date: "2026-06-10" }];
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift(paoUuid(0), "2026-06-10", "T6")).toBe(true);
  });

  it("mês inteiro sem voo emite WARNING se não atinge 20 turnos", () => {
    const input = minimalPaoInput(1);
    const uuid = paoUuid(0);
    input.noFlightDates = Array.from({ length: 30 }, (_, i) => ({
      employeeUuid: uuid,
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    }));
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: uuid, shiftCode: "T6" },
      { employeeUuid: uuid, shiftCode: "T7" },
      { employeeUuid: uuid, shiftCode: "T8" },
    ]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.ensureMinShiftsForFullMonthNoFlight();
    expect(ws.noFlightWarnings.some((w) => w.type === "RESTRIÇÃO VOO MÊS INTEIRO")).toBe(true);
  });
});
