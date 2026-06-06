import { describe, expect, it, vi } from "vitest";
import { RoleUseCase } from "../application/use-cases/role.use-case.js";
import { RoleInUseError } from "../application/use-cases/role-delete.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";
import type { Role } from "@prisma/client";

function mockRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-1",
    name: "Piloto de Apoio Operacional",
    code: "PAO",
    description: "Cobertura PAO",
    active: true,
    displayOrder: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function mockRepo(partial: Partial<RoleRepository>): RoleRepository {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    countEmployees: vi.fn(),
    delete: vi.fn(),
    ...partial,
  } as RoleRepository;
}

describe("RoleUseCase — cargos", () => {
  it("1. criar cargo", async () => {
    const repo = mockRepo({
      create: vi.fn().mockResolvedValue(mockRole({ code: "SUP", name: "Supervisor" })),
    });
    const created = await new RoleUseCase(repo).create({
      name: "Supervisor",
      code: "SUP",
      description: "Supervisão",
    });
    expect(created.code).toBe("SUP");
    expect(created.name).toBe("Supervisor");
  });

  it("2. editar cargo", async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockRole()),
      update: vi.fn().mockResolvedValue(mockRole({ name: "PAO Atualizado" })),
    });
    const updated = await new RoleUseCase(repo).update("role-1", { name: "PAO Atualizado" });
    expect(updated.name).toBe("PAO Atualizado");
  });

  it("3. inativar cargo", async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockRole()),
      update: vi.fn().mockResolvedValue(mockRole({ active: false })),
    });
    const updated = await new RoleUseCase(repo).update("role-1", { active: false });
    expect(updated.active).toBe(false);
  });

  it("4. excluir cargo sem funcionários", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockRole({ id: "role-x", code: "TMP" })),
      countEmployees: vi.fn().mockResolvedValue(0),
      delete: del,
    });
    await new RoleUseCase(repo).remove("role-x");
    expect(del).toHaveBeenCalledWith("role-x");
  });

  it("5. bloquear exclusão com funcionários vinculados", async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockRole()),
      countEmployees: vi.fn().mockResolvedValue(2),
    });
    await expect(new RoleUseCase(repo).remove("role-1")).rejects.toBeInstanceOf(RoleInUseError);
  });
});
