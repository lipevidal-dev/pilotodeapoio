import { describe, expect, it } from "vitest";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import { isoDateKey } from "../domain/rules/date-keys.js";
import type { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";
import type { Employee, Role } from "@prisma/client";

function mockRole(): Role {
  return {
    id: "role-pao",
    name: "Piloto de Apoio Operacional",
    code: "PAO",
    description: null,
    active: true,
    displayOrder: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

describe("Campo aniversário — funcionário", () => {
  it("1. create persiste e retorna birthDate yyyy-mm-dd", async () => {
    const role = mockRole();
    const stored: { birthDate?: Date | null } = {};
    const repo = {
      findAll: async () => [],
      findById: async () => null,
      create: async (data: { birthDate?: string | null }) => {
        stored.birthDate = data.birthDate ? new Date(`${data.birthDate}T12:00:00.000Z`) : null;
        return {
          id: "e1",
          name: "PAO Test",
          type: "PAO" as const,
          roleId: role.id,
          birthDate: stored.birthDate,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          role,
        };
      },
      update: async () => ({}),
      countOperationalHistory: async () => ({
        scheduleAssignments: 0,
        vacations: 0,
        requestedDaysOff: 0,
        flightAssignments: 0,
        preAllocations: 0,
      }),
      delete: async () => undefined,
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: async () => role,
      findByCode: async () => role,
    } as unknown as RoleRepository;

    const created = await new EmployeeUseCase(repo, roleRepo).create({
      name: "PAO Test",
      roleId: role.id,
      birthDate: "1990-06-15",
    });

    expect(isoDateKey(stored.birthDate!)).toBe("1990-06-15");
    expect(created.birthDate).toBe("1990-06-15");
  });

  it("2. update permite limpar aniversário", async () => {
    const role = mockRole();
    const row: Employee & { role: Role } = {
      id: "e1",
      name: "PAO Test",
      type: "PAO",
      roleId: role.id,
      birthDate: new Date("1990-06-15T12:00:00.000Z"),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role,
    };

    let patchedBirth: Date | null | undefined;
    const repo = {
      findAll: async () => [],
      findById: async () => row,
      create: async () => row,
      update: async (_id: string, data: { birthDate?: string | null }) => {
        if (data.birthDate === null) {
          patchedBirth = null;
          return { ...row, birthDate: null };
        }
        if (data.birthDate) {
          patchedBirth = new Date(`${data.birthDate}T12:00:00.000Z`);
          return { ...row, birthDate: patchedBirth };
        }
        return row;
      },
      countOperationalHistory: async () => ({
        scheduleAssignments: 0,
        vacations: 0,
        requestedDaysOff: 0,
        flightAssignments: 0,
        preAllocations: 0,
      }),
      delete: async () => undefined,
    } as unknown as EmployeeRepository;

    const roleRepo = {
      findById: async () => role,
      findByCode: async () => role,
    } as unknown as RoleRepository;

    const updated = await new EmployeeUseCase(repo, roleRepo).update("e1", { birthDate: null });
    expect(patchedBirth).toBeNull();
    expect(updated.birthDate).toBeNull();
  });
});
