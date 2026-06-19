import { describe, expect, it } from "vitest";
import { updatePreAllocationSchema } from "../interfaces/http/dto/pre-allocation.dto.js";
import { updateFlightAssignmentSchema } from "../interfaces/http/dto/flight-assignment.dto.js";
import { updateRequestedDayOffSchema } from "../interfaces/http/dto/requested-day-off.dto.js";
import { updateVacationSchema } from "../interfaces/http/dto/vacation.dto.js";

describe("Cadastros operacionais — payloads de update", () => {
  it("1. editar SIM aceita date, notes e horários", () => {
    const parsed = updatePreAllocationSchema.safeParse({
      date: "2026-06-11",
      notes: "ajuste",
      startTime: "09:00",
      endTime: "21:00",
    });
    expect(parsed.success).toBe(true);
  });

  it("2. editar SIM rejeita horário incompleto", () => {
    const parsed = updatePreAllocationSchema.safeParse({
      startTime: "09:00",
    });
    expect(parsed.success).toBe(false);
  });

  it("3. editar CRS/CMA/OUTRO aceita employeeId e date", () => {
    for (const notes of ["CRS", "CMA", "OUTRO"]) {
      const parsed = updatePreAllocationSchema.safeParse({
        employeeId: "550e8400-e29b-41d4-a716-446655440000",
        date: "2026-06-15",
        notes,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("4. editar VOO aceita date e description", () => {
    const parsed = updateFlightAssignmentSchema.safeParse({
      date: "2026-06-09",
      description: "voo B",
    });
    expect(parsed.success).toBe(true);
  });

  it("5. editar FP aceita status e notes", () => {
    const parsed = updateRequestedDayOffSchema.safeParse({
      date: "2026-06-21",
      status: "APPROVED",
      notes: "alterado",
    });
    expect(parsed.success).toBe(true);
  });

  it("6. editar férias valida período", () => {
    const ok = updateVacationSchema.safeParse({
      startDate: "2026-07-02",
      endDate: "2026-07-06",
      notes: "ajuste",
    });
    const bad = updateVacationSchema.safeParse({
      startDate: "2026-07-10",
      endDate: "2026-07-05",
    });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});
