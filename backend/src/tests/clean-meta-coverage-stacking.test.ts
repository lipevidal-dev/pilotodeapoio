import { describe, expect, it } from "vitest";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";

function emp(id: number, name: string): GenerationInputEmployee {
  const employee: Employee = { id, name, role: "PAO", seniority: id };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function baseInput(paos: GenerationInputEmployee[]): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees: paos,
    shifts: [
      { code: "T6", startTime: "06:00", endTime: "14:00", role: "PAO", active: true },
      { code: "T7", startTime: "14:00", endTime: "22:00", role: "PAO", active: true },
      { code: "T8", startTime: "22:00", endTime: "06:00", role: "PAO", active: true },
      { code: "T9", startTime: "10:00", endTime: "18:00", role: "PAO", active: true },
    ] as Shift[],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts: new Map([
      [1, new Set(["T6"])],
      [2, new Set(["T7"])],
      [3, new Set(["T8"])],
      [4, new Set(["T9"])],
    ]),
  };
}

const motorParams = {
  pao_shift_meta_turnos__T6: 10,
  pao_shift_meta_turnos__T7: 10,
  pao_shift_meta_turnos__T8: 10,
  pao_shift_meta_turnos__T9: 10,
};

function opts(coverage: string[]) {
  return {
    motorVersion: MOTOR_VERSION_NEXT,
    enabledRules: {
      preferred_shifts: true,
      pao_meta_turnos: true,
      coverage_t6: coverage.includes("T6"),
      coverage_t7: coverage.includes("T7"),
      coverage_t8: coverage.includes("T8"),
      coverage_t9: coverage.includes("T9"),
      t8_t8_nd: true,
    },
    motorParams,
    coverageShiftCodes: coverage,
    allowedShiftCodes: coverage,
  };
}

function countShifts(result: ReturnType<typeof generateCleanSchedule>, uuid: string, code: string): number {
  return result.assignments.filter(
    (a) => a.employeeUuid === uuid && a.shiftCode.toUpperCase() === code,
  ).length;
}

function totalRateio(result: ReturnType<typeof generateCleanSchedule>, uuid: string): number {
  return result.assignments.filter((a) => a.employeeUuid === uuid).length;
}

describe("meta por turno vs cobertura empilhada", () => {
  const paos = [emp(1, "A-T6"), emp(2, "B-T7"), emp(3, "C-T8"), emp(4, "D-T9")];

  it("sem T7: PAO preferindo T6 fica perto da meta 10", () => {
    const coverage = ["T6", "T8", "T9"];
    const result = generateCleanSchedule(baseInput(paos), opts(coverage));
    const t6 = countShifts(result, "uuid-1", "T6");
    const t7 = countShifts(result, "uuid-1", "T7");
    expect(t6).toBeLessThanOrEqual(10);
    expect(t7).toBe(0);
    expect(t6).toBeGreaterThan(0);
  });

  it("com T7: PAO preferindo T6 respeita meta total 10 e não empilha cobertura", () => {
    const withoutT7 = generateCleanSchedule(baseInput(paos), opts(["T6", "T8", "T9"]));
    const withT7 = generateCleanSchedule(baseInput(paos), opts(["T6", "T7", "T8", "T9"]));

    const t6Before = countShifts(withoutT7, "uuid-1", "T6");
    const t6After = countShifts(withT7, "uuid-1", "T6");
    const t7After = countShifts(withT7, "uuid-1", "T7");
    const totalAfter = totalRateio(withT7, "uuid-1");

    expect(t6After).toBeLessThanOrEqual(10);
    expect(totalAfter).toBeLessThanOrEqual(10);
    expect(t6After).toBe(t6Before);
    expect(t7After).toBe(0);
  });

  it("com T7: nenhum PAO no escopo passa da meta total 10", () => {
    const withT7 = generateCleanSchedule(baseInput(paos), opts(["T6", "T7", "T8", "T9"]));
    for (const p of paos) {
      expect(totalRateio(withT7, p.uuid)).toBeLessThanOrEqual(10);
    }
  });

  it("teto total vale mesmo com meta por turno desligada na coluna T7", () => {
    const coverage = ["T6", "T7", "T8", "T9"];
    const options = opts(coverage);
    options.enabledRules = {
      ...options.enabledRules,
      [`pao_shift_rule__pao_meta_turnos__T7`]: false,
    };
    const result = generateCleanSchedule(baseInput(paos), options);
    for (const p of paos) {
      expect(totalRateio(result, p.uuid)).toBeLessThanOrEqual(10);
    }
  });
});
