import { describe, expect, it } from "vitest";
import { canPhysicallyDeleteShift } from "../application/use-cases/shift-delete.js";

describe("canPhysicallyDeleteShift", () => {
  it("permite exclusão física sem histórico", () => {
    expect(canPhysicallyDeleteShift({ scheduleAssignments: 0 })).toBe(true);
  });

  it("bloqueia exclusão com assignments", () => {
    expect(canPhysicallyDeleteShift({ scheduleAssignments: 1 })).toBe(false);
  });
});
