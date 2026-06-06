import { describe, expect, it } from "vitest";
import { canPhysicallyDeleteEmployee } from "../application/use-cases/employee-delete.js";

describe("canPhysicallyDeleteEmployee", () => {
  const empty = {
    scheduleAssignments: 0,
    vacations: 0,
    requestedDaysOff: 0,
    flightAssignments: 0,
    preAllocations: 0,
  };

  it("permite exclusão física sem histórico", () => {
    expect(canPhysicallyDeleteEmployee(empty)).toBe(true);
  });

  it("bloqueia exclusão com escala", () => {
    expect(canPhysicallyDeleteEmployee({ ...empty, scheduleAssignments: 1 })).toBe(false);
  });

  it("bloqueia exclusão com férias", () => {
    expect(canPhysicallyDeleteEmployee({ ...empty, vacations: 2 })).toBe(false);
  });

  it("bloqueia exclusão com FP", () => {
    expect(canPhysicallyDeleteEmployee({ ...empty, requestedDaysOff: 1 })).toBe(false);
  });

  it("bloqueia exclusão com voo", () => {
    expect(canPhysicallyDeleteEmployee({ ...empty, flightAssignments: 1 })).toBe(false);
  });

  it("bloqueia exclusão com pré-alocação manual", () => {
    expect(canPhysicallyDeleteEmployee({ ...empty, preAllocations: 1 })).toBe(false);
  });

  it("permite exclusão quando só há folgas geradas pelo motor", () => {
    expect(
      canPhysicallyDeleteEmployee({
        ...empty,
        preAllocations: 0,
        generatorPreAllocations: 4,
      }),
    ).toBe(true);
  });
});
