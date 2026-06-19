import { describe, expect, it } from "vitest";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";
import { paoShiftParamId } from "../domain/schedule/next-motor/next-motor-shift-params.js";

function emp(id: number, name: string, pref: string): GenerationInputEmployee {
  const employee: Employee = { id, name, role: "PAO", seniority: id };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function baseInput(paos: GenerationInputEmployee[], prefs: Array<[number, string]>): GenerationInput {
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
    preferredShifts: new Map(prefs.map(([id, code]) => [id, new Set([code])])),
  };
}

const motorParams = {
  [paoShiftParamId("meta_turnos", "T6")]: 8,
  [paoShiftParamId("meta_turnos", "T7")]: 8,
  [paoShiftParamId("meta_turnos", "T8")]: 8,
  [paoShiftParamId("meta_turnos", "T9")]: 8,
  [paoShiftParamId("meta_dias_trabalhados", "T6")]: 20,
  [paoShiftParamId("meta_dias_trabalhados", "T7")]: 20,
  [paoShiftParamId("meta_dias_trabalhados", "T8")]: 20,
  [paoShiftParamId("meta_dias_trabalhados", "T9")]: 20,
};

function opts(coverage: string[]) {
  return {
    motorVersion: MOTOR_VERSION_NEXT,
    enabledRules: {
      preferred_shifts: true,
      pao_meta_turnos: true,
      pao_meta_dias_trabalhados: true,
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

function countRateio(result: ReturnType<typeof generateCleanSchedule>, uuid: string): number {
  return result.assignments.filter((a) => a.employeeUuid === uuid).length;
}

function countProductiveDays(
  result: ReturnType<typeof generateCleanSchedule>,
  uuid: string,
): number {
  const shifts = result.assignments.filter((a) => a.employeeUuid === uuid).length;
  const nd = result.allocations.filter(
    (a) => a.employeeUuid === uuid && a.label.toUpperCase() === "ND",
  ).length;
  return shifts + nd;
}

describe("teto PAO alinhado à projeção do escopo", () => {
  const paos = [
    emp(1, "A-T6", "T6"),
    emp(2, "B-T7", "T7"),
    emp(3, "C-T8", "T8"),
    emp(4, "D-T9", "T9"),
  ];
  const prefs: Array<[number, string]> = [
    [1, "T6"],
    [2, "T7"],
    [3, "T8"],
    [4, "T9"],
  ];

  it("respeita meta de turnos (8) e dias trabalhados (20) por PAO", () => {
    const result = generateCleanSchedule(baseInput(paos, prefs), opts(["T6", "T7", "T8", "T9"]));
    for (const p of paos) {
      expect(countRateio(result, p.uuid)).toBeLessThanOrEqual(8);
      expect(countProductiveDays(result, p.uuid)).toBeLessThanOrEqual(20);
    }
  });
});
