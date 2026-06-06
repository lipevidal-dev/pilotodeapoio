import { describe, expect, it, vi } from "vitest";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import type { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";
import type { Employee, Role } from "@prisma/client";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function mockEmployee(overrides: Partial<Employee> = {}): Employee & { role: Role } {
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

describe("Funcionário com cargo da API", () => {
  it("6. cadastro usa roleId e retorna cargoCode", async () => {
    const empRepo = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn().mockResolvedValue(mockEmployee()),
      update: vi.fn(),
      countOperationalHistory: vi.fn(),
      delete: vi.fn(),
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: vi.fn().mockResolvedValue(mockRole()),
      findByCode: vi.fn(),
    } as unknown as RoleRepository;

    const created = await new EmployeeUseCase(empRepo, roleRepo).create({
      name: "PAO Test",
      roleId: "role-pao",
    });

    expect(created.roleId).toBe("role-pao");
    expect(created.cargoCode).toBe("PAO");
    expect(created.type).toBe("PAO");
  });

  it("7. funcionário PAO/APAO existentes continuam válidos", async () => {
    const result = engine.generate(realisticGenerationInput());
    expect(result.summary.paoCount).toBeGreaterThan(0);
    expect(result.summary.apaoCount).toBeGreaterThan(0);
    expect(result.summary.valid).toBe(true);
  }, SLOW_MS);

  it("8. motor gera escala normalmente com cargos cadastrados", () => {
    const input = realisticGenerationInput({
      motorRoleCodes: { pao: "PAO", apao: "APAO" },
    });
    const result = engine.generate(input);
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.summary.mathClosureOk).toBe(true);
  }, SLOW_MS);
});
