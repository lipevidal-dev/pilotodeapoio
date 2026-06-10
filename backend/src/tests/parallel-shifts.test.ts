import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Shift as PrismaShift, Role } from "@prisma/client";
import { ShiftUseCase } from "../application/use-cases/shift.use-case.js";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import {
  EmployeeDuplicatePreferredShiftError,
  EmployeeShiftPreferenceConflictError,
} from "../application/errors/employee.errors.js";
import { calculateOperationalDemand } from "../domain/schedule/demand-planning-demand.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { allocateParallelShifts } from "../domain/schedule/real-schedule-parallel.js";
import { buildEmployeeDiagnostics } from "../domain/schedule/real-schedule-employee-diagnostics.js";
import {
  buildManualEditValidationContext,
  validateManualSet,
} from "../domain/schedule/manual-edit-validator.js";
import { buildPreferredShiftMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { minimalPaoInput } from "./generation-fixtures.js";
import type { Employee } from "../domain/employee/types.js";
import type { ShiftRepository } from "../infrastructure/repositories/shift.repository.js";
import type { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";

function mockShift(overrides: Partial<PrismaShift> = {}): PrismaShift {
  return {
    id: "shift-1",
    code: "T6",
    name: "Turno 6 PAO",
    startTime: "06:00",
    endTime: "14:00",
    durationHours: 8,
    employeeTypeAllowed: "PAO",
    active: true,
    displayOrder: 1,
    mandatoryCoverage: true,
    requiresT8PairNd: false,
    coverageType: "REQUIRED",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function paoUuid(i = 0): string {
  return `uuid-${i + 1}`;
}

function t9Shift() {
  return {
    code: "T9",
    role: "PAO" as const,
    name: "Turno 9 PAO",
    startTime: "10:00",
    endTime: "18:00",
    minStaff: 1,
    maxStaff: 1,
    coverageType: "PARALLEL" as const,
  };
}

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

describe("Shift coverageType", () => {
  it("1. criar turno REQUIRED", async () => {
    const repo = {
      create: vi.fn().mockResolvedValue(mockShift()),
    } as unknown as ShiftRepository;
    const created = await new ShiftUseCase(repo).create({
      code: "T6",
      name: "Turno 6",
      startTime: "06:00",
      endTime: "14:00",
      roleType: "PAO",
      coverageType: "REQUIRED",
    });
    expect(created.coverageType).toBe("REQUIRED");
  });

  it("2. criar/editar turno PARALLEL", async () => {
    const repo = {
      create: vi.fn().mockResolvedValue(mockShift({ code: "T9", coverageType: "PARALLEL", mandatoryCoverage: false })),
      findById: vi.fn().mockResolvedValue(mockShift({ code: "T9", coverageType: "REQUIRED" })),
      update: vi.fn().mockResolvedValue(mockShift({ code: "T9", coverageType: "PARALLEL", mandatoryCoverage: false })),
    } as unknown as ShiftRepository;
    const created = await new ShiftUseCase(repo).create({
      code: "T9",
      name: "Turno 9",
      startTime: "10:00",
      endTime: "18:00",
      roleType: "PAO",
      coverageType: "PARALLEL",
    });
    expect(created.coverageType).toBe("PARALLEL");
    const updated = await new ShiftUseCase(repo).update("shift-1", { coverageType: "PARALLEL" });
    expect(updated.coverageType).toBe("PARALLEL");
  });

  it("3. migration default REQUIRED em mock", () => {
    expect(mockShift().coverageType).toBe("REQUIRED");
  });
});

describe("Employee preferred shifts", () => {
  const create = vi.fn();
  const empRepo = {
    create,
  } as unknown as EmployeeRepository;
  const roleRepo = {
    findById: vi.fn().mockResolvedValue(rolePao),
  } as unknown as RoleRepository;
  const shiftRepo = {
    findAll: vi.fn().mockResolvedValue([
      mockShift({ id: "shift-t9", code: "T9", coverageType: "PARALLEL" }),
    ]),
  } as unknown as ShiftRepository;

  beforeEach(() => {
    vi.clearAllMocks();
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
      flightRestrictions: [],
      shiftRestrictions: [],
      preferredShifts: [],
    });
  });

  it("4. criar funcionário com preferredShiftIds", async () => {
    await new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
      name: "PAO Test",
      roleId: rolePao.id,
      preferredShiftIds: ["shift-t9"],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ preferredShiftIds: ["shift-t9"] }),
    );
  });

  it("5. rejeita preferredShiftIds duplicado", async () => {
    await expect(
      new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
        name: "PAO Test",
        roleId: rolePao.id,
        preferredShiftIds: ["shift-t9", "shift-t9"],
      }),
    ).rejects.toBeInstanceOf(EmployeeDuplicatePreferredShiftError);
  });

  it("6. rejeita conflito preferred + restricted", async () => {
    await expect(
      new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
        name: "PAO Test",
        roleId: rolePao.id,
        restrictedShiftIds: ["shift-t9"],
        preferredShiftIds: ["shift-t9"],
      }),
    ).rejects.toBeInstanceOf(EmployeeShiftPreferenceConflictError);
  });

  it("7. cadastro não cria scheduleAssignment", async () => {
    await new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
      name: "PAO Test",
      roleId: rolePao.id,
      preferredShiftIds: ["shift-t9"],
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("Motor — turnos paralelos T9", () => {
  function inputWithT9Preference() {
    const input = minimalPaoInput(3);
    input.shifts = [
      ...input.shifts.map((s) => ({ ...s, coverageType: "REQUIRED" as const })),
      t9Shift(),
    ];
    input.preferredShifts = buildPreferredShiftMap(input.employees, [
      { employeeUuid: paoUuid(0), shiftCode: "T9" },
    ]);
    return input;
  }

  it("8. T9 PARALLEL não entra na demanda mensal", () => {
    const demand = calculateOperationalDemand(30);
    expect(demand.shiftsPerDay).toBe(3);
    expect(demand.totalDemand).toBe(90);
    expect((demand.perShift as Record<string, number>).T9).toBeUndefined();
  });

  it("9. motor não usa T9 para cobrir T6/T7/T8", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.coverPaoShifts(["T6", "T7", "T8"]);
    expect(ws.toAssignments().some((a) => a.shiftCode === "T9")).toBe(false);
  });

  it("10. motor aloca T9 apenas para funcionário com preferência", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateParallelShifts(ws);
    const t9Assignments = ws.toAssignments().filter((a) => a.shiftCode === "T9");
    expect(t9Assignments.length).toBeGreaterThan(0);
    expect(t9Assignments.every((a) => a.employeeUuid === paoUuid(0))).toBe(true);
    expect(ws.tryAssignShift(paoUuid(1), "2026-06-05", "T9")).toBe(false);
  });

  it("11. T9 pode coexistir com T6 de outro funcionário no mesmo dia", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const day = "2026-06-10";
    expect(ws.tryAssignShift(paoUuid(1), day, "T6")).toBe(true);
    expect(ws.tryAssignShift(paoUuid(0), day, "T9")).toBe(true);
  });

  it("12. T9 bloqueia se o próprio funcionário já tem turno no dia", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const day = "2026-06-11";
    expect(ws.tryAssignShift(paoUuid(0), day, "T7")).toBe(true);
    expect(ws.tryAssignShift(paoUuid(0), day, "T9")).toBe(false);
  });

  it("13/14. manual edit respeita T9 PARALLEL e bloqueia sem preferência", () => {
    const employees = [
      { id: paoUuid(0), name: "PAO 1", role: "PAO", seniorityNumber: 1 },
      { id: paoUuid(1), name: "PAO 2", role: "PAO", seniorityNumber: 2 },
    ];
    const ctx = {
      year: 2026,
      month: 6,
      employees: employees.map((e, i) => ({
        id: i + 1,
        name: e.name,
        role: "PAO" as Employee["role"],
        seniority: e.seniorityNumber ?? 1,
      })),
      shifts: [
        {
          code: "T6",
          role: "PAO" as const,
          name: "T6",
          startTime: "06:00",
          endTime: "14:00",
          minStaff: 1,
          maxStaff: 1,
          coverageType: "REQUIRED" as const,
        },
        t9Shift(),
      ],
      assignments: [],
      allocations: [],
    };
    const v = buildManualEditValidationContext({
      ctx,
      employees,
      shiftRestrictionRows: [],
      preferredShiftRows: [{ employeeUuid: paoUuid(0), shiftCode: "T9" }],
      noFlightDates: [],
      vacationDays: [],
      approvedDayOff: [],
      assignments: [],
      preAllocations: [],
      flightDays: [],
    });
    const day = "2026-06-12";
    const allowed = validateManualSet(v, { employeeId: paoUuid(0), date: day }, "T9");
    expect(allowed.some((c) => c.code === "PARALLEL_SHIFT_NOT_PREFERRED")).toBe(false);
    const blocked = validateManualSet(v, { employeeId: paoUuid(1), date: day }, "T9");
    expect(blocked.some((c) => c.code === "PARALLEL_SHIFT_NOT_PREFERRED")).toBe(true);
  });

  it("15. diagnóstico mostra preferredShiftCodes e parallelShiftCount", () => {
    const input = inputWithT9Preference();
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateParallelShifts(ws);
    const diagnostics = buildEmployeeDiagnostics(ws);
    const d0 = diagnostics.find((d) => d.employeeUuid === paoUuid(0));
    expect(d0?.preferredShiftCodes).toContain("T9");
    expect(d0?.preferredParallelShiftCodes).toContain("T9");
    expect(d0?.parallelShiftCount).toBeGreaterThan(0);
  });
});
