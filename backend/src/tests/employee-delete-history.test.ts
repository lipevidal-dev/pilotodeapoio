import { describe, expect, it, vi, beforeEach } from "vitest";
import { EmployeeUseCase } from "../application/use-cases/employee.use-case.js";
import type { EmployeeRepository } from "../infrastructure/repositories/employee.repository.js";
import type { RoleRepository } from "../infrastructure/repositories/role.repository.js";

describe("exclusão de funcionário — histórico gerado pelo motor", () => {
  const mockEmployee = {
    id: "apao-1",
    name: "APAO Test",
    type: "APAO" as const,
    seniorityNumber: 1,
    active: true,
    roleId: "role-1",
    birthDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: { id: "role-1", code: "APAO", name: "APAO", active: true, displayOrder: 1, description: null, createdAt: new Date(), updatedAt: new Date() },
    flightRestrictions: [],
    shiftRestrictions: [],
  };

  let deleteFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deleteFn = vi.fn().mockResolvedValue(mockEmployee);
  });

  it("permite excluir quando só existem folgas geradas pelo motor em pre_allocations", async () => {
    const empRepo = {
      findById: vi.fn().mockResolvedValue(mockEmployee),
      countOperationalHistory: vi.fn().mockResolvedValue({
        scheduleAssignments: 0,
        vacations: 0,
        requestedDaysOff: 0,
        flightAssignments: 0,
        preAllocations: 0,
        generatorPreAllocations: 3,
      }),
      delete: deleteFn,
    } as unknown as EmployeeRepository;

    await new EmployeeUseCase(empRepo, {} as RoleRepository).remove("apao-1");
    expect(deleteFn).toHaveBeenCalledWith("apao-1");
  });
});
