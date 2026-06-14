import { describe, expect, it } from "vitest";
import { canAssignShiftWithRateio } from "../domain/schedule/assignment-eligibility.js";

describe("canAssignShiftWithRateio", () => {
  const base = {
    monthDays: 31,
    day: 1,
    shift: "T6" as const,
    employeeId: "pao-1",
    currentTurnCounts: new Map([["pao-1", 12]]),
    maxTurnCounts: new Map([["pao-1", 12]]),
  };

  it("bloqueia acima do max sem overflow emergencial", () => {
    const r = canAssignShiftWithRateio(base);
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain("RATEIO_TURNOS_ACIMA_MAX");
  });

  it("permite overflow emergencial com penalidade", () => {
    const r = canAssignShiftWithRateio({
      ...base,
      allowEmergencyOverflow: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.reasons).toContain("RATEIO_TURNOS_ACIMA_MAX_EMERGENCY_OVERFLOW");
    expect(r.scorePenalty).toBeGreaterThan(1000);
  });

  it("prioriza turno preferido", () => {
    const r = canAssignShiftWithRateio({
      ...base,
      currentTurnCounts: new Map([["pao-1", 5]]),
      preferredShiftByEmployee: new Map([["pao-1", "T6"]]),
    });
    expect(r.allowed).toBe(true);
    expect(r.scorePenalty).toBeLessThan(0);
  });
});
