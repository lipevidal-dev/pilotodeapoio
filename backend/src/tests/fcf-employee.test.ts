import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Employee, Role, Shift } from "@prisma/client";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";
import type { ShiftRepository } from "../infrastructure/repositories/shift.repository.js";
import { EmployeeFcfShiftNotFoundError } from "../application/errors/employee.errors.js";
import { validateFcfConfig, normalizeFcfSchedule } from "../domain/employee/fcf-config.js";

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

const shiftT7: Shift = {
  id: "shift-t7",
  code: "T7",
  name: "Turno 7",
  startTime: "14:00",
  endTime: "22:00",
  durationHours: 8,
  employeeTypeAllowed: "PAO",
  active: true,
  displayOrder: 2,
  mandatoryCoverage: true,
  requiresT8PairNd: false,
  coverageType: "REQUIRED",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const shiftT8: Shift = { ...shiftT7, id: "shift-t8", code: "T8", name: "Turno 8" };

describe("fcf-config", () => {
  it("normaliza schedule com um turno por dia", () => {
    expect(
      normalizeFcfSchedule([
        { shiftId: "a", weekday: 1 },
        { shiftId: "b", weekday: 3 },
        { shiftId: "c", weekday: 1 },
      ]),
    ).toEqual([
      { shiftId: "a", weekday: 1 },
      { shiftId: "b", weekday: 3 },
    ]);
  });

  it("ignora entradas legadas de folga social no JSON", () => {
    expect(
      normalizeFcfSchedule([
        { kind: "folga_social", weekday: 6 },
        { shiftId: "a", weekday: 1 },
      ]),
    ).toEqual([{ shiftId: "a", weekday: 1 }]);
  });

  it("permite FCF ativo sem alocações no cadastro", () => {
    expect(validateFcfConfig({ isFcf: true, fcfSchedule: [] })).toBeNull();
    expect(
      validateFcfConfig({ isFcf: true, fcfSchedule: [{ shiftId: "x", weekday: 1 }] }),
    ).toBeNull();
  });
});

describe("EmployeeUseCase — FCF", () => {
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

  const shiftFindAll = vi.fn();
  const shiftRepo = {
    findById: vi.fn(),
    findAll: shiftFindAll,
  } as unknown as ShiftRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    shiftFindAll.mockResolvedValue([shiftT7, shiftT8]);
  });

  function employeeRow(overrides: Partial<Employee> = {}) {
    return {
      id: "emp-1",
      name: "PAO FCF",
      type: "PAO" as const,
      roleId: rolePao.id,
      seniorityNumber: 1,
      active: true,
      birthDate: null,
      isFcf: true,
      fcfSchedule: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      role: rolePao,
      flightRestrictions: [],
      shiftRestrictions: [],
      preferredShifts: [],
      specificShiftRequests: [],
      ...overrides,
    };
  }

  it("cria funcionário FCF sem alocações no cadastro", async () => {
    create.mockResolvedValue(employeeRow());

    const api = await new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
      name: "PAO FCF",
      roleId: rolePao.id,
      isFcf: true,
      fcfSchedule: [],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        isFcf: true,
        fcfSchedule: [],
      }),
    );
    expect(api.isFcf).toBe(true);
  });

  it("cria funcionário com alocações FCF legadas opcionais", async () => {
    create.mockResolvedValue(
      employeeRow({
        fcfSchedule: [
          { shiftId: shiftT7.id, weekday: 1 },
          { shiftId: shiftT8.id, weekday: 3 },
        ],
      }),
    );

    await new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
      name: "PAO FCF",
      roleId: rolePao.id,
      isFcf: true,
      fcfSchedule: [
        { shiftId: shiftT7.id, weekday: 1 },
        { shiftId: shiftT8.id, weekday: 3 },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        fcfSchedule: [
          { shiftId: shiftT7.id, weekday: 1 },
          { shiftId: shiftT8.id, weekday: 3 },
        ],
      }),
    );
  });

  it("rejeita turno FCF inativo quando schedule informado", async () => {
    shiftFindAll.mockResolvedValue([{ ...shiftT7, active: false }]);
    await expect(
      new EmployeeUseCase(empRepo, roleRepo, shiftRepo).create({
        name: "PAO FCF",
        roleId: rolePao.id,
        isFcf: true,
        fcfSchedule: [{ shiftId: shiftT7.id, weekday: 1 }],
      }),
    ).rejects.toBeInstanceOf(EmployeeFcfShiftNotFoundError);
  });

  it("limpa FCF ao desmarcar isFcf", async () => {
    findById.mockResolvedValue(employeeRow());
    update.mockResolvedValue(employeeRow({ isFcf: false, fcfSchedule: [] }));

    await new EmployeeUseCase(empRepo, roleRepo, shiftRepo).update("emp-1", { isFcf: false });

    expect(update).toHaveBeenCalledWith(
      "emp-1",
      expect.objectContaining({
        isFcf: false,
        fcfSchedule: [],
      }),
    );
  });
});
