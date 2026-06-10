import { describe, expect, it, vi } from "vitest";
import { ShiftUseCase } from "../application/use-cases/shift.use-case.js";
import { ShiftHasOperationalHistoryError } from "../application/use-cases/shift-delete.js";
import { prismaShiftToDomain } from "../infrastructure/mappers/shift.mapper.js";
import type { ShiftRepository } from "../infrastructure/repositories/shift.repository.js";
import type { Shift as PrismaShift } from "@prisma/client";

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

function mockRepo(partial: Partial<ShiftRepository>): ShiftRepository {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    countOperationalHistory: vi.fn(),
    delete: vi.fn(),
    ...partial,
  } as ShiftRepository;
}

describe("ShiftUseCase", () => {
  it("1. listar turnos", async () => {
    const repo = mockRepo({
      findAll: vi.fn().mockResolvedValue([
        mockShift(),
        mockShift({ id: "s2", code: "T7", displayOrder: 2 }),
      ]),
    });
    const list = await new ShiftUseCase(repo).list();
    expect(list.length).toBe(2);
    expect(list[0].code).toBe("T6");
    expect(list[0].roleType).toBe("PAO");
  });

  it("2. criar turno", async () => {
    const repo = mockRepo({
      create: vi.fn().mockResolvedValue(mockShift({ code: "TX", name: "Teste" })),
    });
    const created = await new ShiftUseCase(repo).create({
      code: "TX",
      name: "Teste",
      startTime: "08:00",
      endTime: "16:00",
      roleType: "PAO",
    });
    expect(created.code).toBe("TX");
    expect(created.durationHours).toBe(8);
  });

  it("3. editar turno", async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockShift()),
      update: vi.fn().mockResolvedValue(mockShift({ name: "Novo nome" })),
    });
    const updated = await new ShiftUseCase(repo).update("shift-1", { name: "Novo nome" });
    expect(updated.name).toBe("Novo nome");
  });

  it("4. inativar turno via update", async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockShift()),
      update: vi.fn().mockResolvedValue(mockShift({ active: false })),
    });
    const updated = await new ShiftUseCase(repo).update("shift-1", { active: false });
    expect(updated.active).toBe(false);
  });

  it("5. excluir turno sem histórico", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockShift()),
      countOperationalHistory: vi.fn().mockResolvedValue({ scheduleAssignments: 0 }),
      delete: del,
    });
    await new ShiftUseCase(repo).remove("shift-1");
    expect(del).toHaveBeenCalledWith("shift-1");
  });

  it("6. bloquear exclusão com histórico", async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(mockShift()),
      countOperationalHistory: vi.fn().mockResolvedValue({ scheduleAssignments: 3 }),
    });
    await expect(new ShiftUseCase(repo).remove("shift-1")).rejects.toBeInstanceOf(
      ShiftHasOperationalHistoryError,
    );
  });

  it("7. motor ignora turno inativo no mapper de domínio", () => {
    expect(prismaShiftToDomain(mockShift({ active: true })).active).toBe(true);
    expect(prismaShiftToDomain(mockShift({ active: false })).active).toBe(false);
  });
});
