import { describe, expect, it, vi } from "vitest";
import type { Employee, Role } from "@prisma/client";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import {
  compareEmployeesBySeniority,
  formatSeniorityLabel,
  insertIdAtPosition,
  reorderIdsInGroup,
} from "../domain/employee/seniority.js";
import type { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";

function mockEmployee(overrides: Partial<Employee & { role: Role }> = {}): Employee & { role: Role } {
  return {
    id: "emp-1",
    name: "PAO Test",
    type: "PAO",
    roleId: "role-pao",
    seniorityNumber: 1,
    active: true,
    birthDate: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    role: {
      id: "role-pao",
      name: "Piloto de Apoio Operacional",
      code: "PAO",
      description: null,
      active: true,
      displayOrder: 1,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    ...overrides,
  } as Employee & { role: Role };
}

function mockRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-pao",
    name: "Piloto de Apoio Operacional",
    code: "PAO",
    description: null,
    active: true,
    displayOrder: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("formatSeniorityLabel", () => {
  it("PAO exibe número simples", () => {
    expect(formatSeniorityLabel("PAO", 3)).toBe("3");
  });

  it("APAO exibe número com sufixo A", () => {
    expect(formatSeniorityLabel("APAO", 2)).toBe("2A");
  });
});

describe("reorderIdsInGroup", () => {
  it("move último para primeira posição", () => {
    expect(reorderIdsInGroup(["a", "b", "c"], "c", 1)).toEqual(["c", "a", "b"]);
  });

  it("move primeiro para última posição", () => {
    expect(reorderIdsInGroup(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
  });

  it("insere novo id na posição informada", () => {
    expect(insertIdAtPosition(["a", "c"], "b", 2)).toEqual(["a", "b", "c"]);
  });
});

describe("compareEmployeesBySeniority", () => {
  it("ordena PAO antes de APAO", () => {
    const rows = [
      { type: "APAO", seniorityNumber: 1, name: "Z" },
      { type: "PAO", seniorityNumber: 9, name: "A" },
    ].sort(compareEmployeesBySeniority);
    expect(rows[0].type).toBe("PAO");
  });

  it("ordena por seniorityNumber dentro do grupo", () => {
    const rows = [
      { type: "PAO", seniorityNumber: 3, name: "C" },
      { type: "PAO", seniorityNumber: 1, name: "A" },
      { type: "PAO", seniorityNumber: 2, name: "B" },
    ].sort(compareEmployeesBySeniority);
    expect(rows.map((r) => r.seniorityNumber)).toEqual([1, 2, 3]);
  });
});

describe("EmployeeUseCase — senioridade", () => {
  it("criar PAO sem senioridade repassa criação ao repositório", async () => {
    const create = vi.fn().mockResolvedValue(mockEmployee({ seniorityNumber: 2 }));
    const empRepo = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create,
      update: vi.fn(),
      countOperationalHistory: vi.fn(),
      delete: vi.fn(),
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: vi.fn().mockResolvedValue(mockRole()),
      findByCode: vi.fn(),
    } as unknown as RoleRepository;

    const created = await new EmployeeUseCase(empRepo, roleRepo).create({
      name: "PAO Novo",
      roleId: "role-pao",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PAO", seniorityNumber: undefined }),
    );
    expect(created.seniorityNumber).toBe(2);
    expect(created.seniorityLabel).toBe("2");
  });

  it("criar APAO sem senioridade retorna label com A", async () => {
    const empRepo = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn().mockResolvedValue(
        mockEmployee({
          type: "APAO",
          seniorityNumber: 1,
          roleId: "role-apao",
          role: { ...mockRole(), code: "APAO", id: "role-apao" },
        }),
      ),
      update: vi.fn(),
      countOperationalHistory: vi.fn(),
      delete: vi.fn(),
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: vi.fn().mockResolvedValue(mockRole({ id: "role-apao", code: "APAO" })),
      findByCode: vi.fn(),
    } as unknown as RoleRepository;

    const created = await new EmployeeUseCase(empRepo, roleRepo).create({
      name: "APAO Novo",
      roleId: "role-apao",
    });

    expect(created.seniorityLabel).toBe("1A");
  });

  it("criar PAO com senioridade informada repassa ao repositório", async () => {
    const create = vi.fn().mockResolvedValue(mockEmployee({ seniorityNumber: 2 }));
    const empRepo = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create,
      update: vi.fn(),
      countOperationalHistory: vi.fn(),
      delete: vi.fn(),
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: vi.fn().mockResolvedValue(mockRole()),
      findByCode: vi.fn(),
    } as unknown as RoleRepository;

    await new EmployeeUseCase(empRepo, roleRepo).create({
      name: "PAO Inserido",
      roleId: "role-pao",
      seniorityNumber: 2,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ seniorityNumber: 2 }));
  });

  it("editar senioridade repassa ao repositório", async () => {
    const update = vi.fn().mockResolvedValue(mockEmployee({ seniorityNumber: 1 }));
    const empRepo = {
      findAll: vi.fn(),
      findById: vi.fn().mockResolvedValue(mockEmployee({ seniorityNumber: 3 })),
      create: vi.fn(),
      update,
      countOperationalHistory: vi.fn(),
      delete: vi.fn(),
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: vi.fn(),
      findByCode: vi.fn(),
    } as unknown as RoleRepository;

    await new EmployeeUseCase(empRepo, roleRepo).update("emp-1", { seniorityNumber: 1 });

    expect(update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ seniorityNumber: 1 }));
  });

  it("excluir funcionário delega ao repositório com compactação", async () => {
    const del = vi.fn().mockResolvedValue(mockEmployee({ seniorityNumber: 2 }));
    const empRepo = {
      findAll: vi.fn(),
      findById: vi.fn().mockResolvedValue(mockEmployee({ seniorityNumber: 2 })),
      create: vi.fn(),
      update: vi.fn(),
      countOperationalHistory: vi.fn().mockResolvedValue({
        scheduleAssignments: 0,
        vacations: 0,
        requestedDaysOff: 0,
        flightAssignments: 0,
        preAllocations: 0,
      }),
      delete: del,
    } as unknown as EmployeeRepository;

    const roleRepo = {} as RoleRepository;

    await new EmployeeUseCase(empRepo, roleRepo).remove("emp-1");
    expect(del).toHaveBeenCalledWith("emp-1");
  });

  it("listagem expõe senioridade ordenada pelo repositório", async () => {
    const rows = [
      mockEmployee({ id: "p2", name: "B", seniorityNumber: 2 }),
      mockEmployee({ id: "p1", name: "A", seniorityNumber: 1 }),
    ];
    const empRepo = {
      findAll: vi.fn().mockResolvedValue(rows),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      countOperationalHistory: vi.fn(),
      delete: vi.fn(),
    } as unknown as EmployeeRepository;

    const listed = await new EmployeeUseCase(empRepo, {} as RoleRepository).list();
    expect(listed[0].seniorityNumber).toBe(2);
    expect(listed[0].seniorityLabel).toBe("2");
  });
});

describe("listActiveEmployees — ordenação para escala", () => {
  it("compareEmployeesBySeniority alinha PAO e APAO para grade visual", () => {
    const employees = [
      { type: "APAO", seniorityNumber: 2, name: "APAO B" },
      { type: "PAO", seniorityNumber: 2, name: "PAO B" },
      { type: "APAO", seniorityNumber: 1, name: "APAO A" },
      { type: "PAO", seniorityNumber: 1, name: "PAO A" },
    ].sort(compareEmployeesBySeniority);

    expect(employees.map((e) => `${e.type}-${e.seniorityNumber}`)).toEqual([
      "PAO-1",
      "PAO-2",
      "APAO-1",
      "APAO-2",
    ]);
  });
});
