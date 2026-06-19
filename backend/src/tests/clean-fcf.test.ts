import { describe, expect, it } from "vitest";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";

function emp(id: number, name: string, role: Employee["role"] = "PAO"): GenerationInputEmployee {
  const employee: Employee = { id, name, role, seniority: id };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function baseShifts(): Shift[] {
  return [
    { code: "T6", startTime: "06:00", endTime: "14:00", role: "PAO", active: true },
    { code: "T7", startTime: "14:00", endTime: "22:00", role: "PAO", active: true },
    { code: "T8", startTime: "22:00", endTime: "06:00", role: "PAO", active: true },
    { code: "T9", startTime: "10:00", endTime: "18:00", role: "PAO", active: true },
  ];
}

const motorOpts = {
  motorVersion: MOTOR_VERSION_NEXT,
  enabledRules: { fcf_weekday_shift: true, preferred_shifts: true, pao_meta_turnos: true },
  motorParams: { pao_meta_turnos: 4 },
  coverageShiftCodes: ["T6", "T7", "T8", "T9"],
};

function baseInput(
  paos: GenerationInputEmployee[],
  overrides: Partial<GenerationInput> = {},
): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees: paos,
    shifts: baseShifts(),
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    ...overrides,
  };
}

describe("CleanEngine — FCF", () => {
  it("aloca turno FCF nos dias da semana configurados", () => {
    const paos = [emp(1, "FCF Ana"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const input = baseInput(paos, {
      fcfRules: [{ employeeUuid: "uuid-1", shiftCode: "T7", weekday: 1 }],
    });

    const result = generateCleanSchedule(input);
    const mondays = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"];
    for (const date of mondays) {
      const assignment = result.assignments.find((a) => a.employeeUuid === "uuid-1" && a.date === date);
      expect(assignment?.shiftCode).toBe("T7");
    }
  });

  it("não sobrescreve férias no dia FCF", () => {
    const paos = [emp(1, "FCF Ana"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const input = baseInput(paos, {
      fcfRules: [{ employeeUuid: "uuid-1", shiftCode: "T7", weekday: 1 }],
      vacationDays: [{ employeeUuid: "uuid-1", date: "2026-07-06" }],
    });

    const result = generateCleanSchedule(input);
    const onVacation = result.assignments.find(
      (a) => a.employeeUuid === "uuid-1" && a.date === "2026-07-06",
    );
    expect(onVacation).toBeUndefined();
    expect(
      result.violations.some(
        (v) => v.type === "FCF_SHIFT_NOT_APPLIED" && v.date === "2026-07-06",
      ),
    ).toBe(false);
  });

  it("respeita descanso 12h vindo do mês anterior", () => {
    const paos = [emp(1, "FCF Ana"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const input = baseInput(paos, {
      fcfRules: [{ employeeUuid: "uuid-1", shiftCode: "T6", weekday: 3 }],
      crossMonthHistory: {
        assignments: [{ employeeUuid: "uuid-1", date: "2026-06-30", shiftCode: "T8" }],
        allocations: [],
      },
    });

    const result = generateCleanSchedule(input);
    const wednesday = result.assignments.find(
      (a) => a.employeeUuid === "uuid-1" && a.date === "2026-07-01",
    );
    expect(wednesday).toBeUndefined();
    expect(
      result.violations.some(
        (v) => v.type === "FCF_SHIFT_NOT_APPLIED" && v.date === "2026-07-01",
      ),
    ).toBe(true);
  });

  it("gera warning FCF_SHIFT_NOT_APPLIED quando inviável", () => {
    const paos = [emp(1, "FCF Ana"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const input = baseInput(paos, {
      fcfRules: [{ employeeUuid: "uuid-1", shiftCode: "T7", weekday: 1 }],
      approvedDayOff: [{ employeeUuid: "uuid-1", date: "2026-07-13" }],
    });

    const result = generateCleanSchedule(input);
    const warning = result.violations.find(
      (v) => v.type === "FCF_SHIFT_NOT_APPLIED" && v.date === "2026-07-13",
    );
    expect(warning).toBeDefined();
    expect(warning?.level).toBe("WARNING");
    expect(warning?.employee).toBe("FCF Ana");
  });

  it("FCF T9 na quinta sem preferência T9 no cadastro (prioridade FCF)", () => {
    const paos = [emp(1, "Rafael"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const input = baseInput(paos, {
      fcfRules: [{ employeeUuid: "uuid-1", shiftCode: "T9", weekday: 4 }],
    });
    const result = generateCleanSchedule(input, motorOpts);
    const thursdays = ["2026-07-02", "2026-07-09", "2026-07-16", "2026-07-23", "2026-07-30"];
    for (const date of thursdays) {
      const assignment = result.assignments.find((a) => a.employeeUuid === "uuid-1" && a.date === date);
      expect(assignment?.shiftCode).toBe("T9");
    }
  });

  it("FCF T9 quinzenal: aloca só nas quintas fora das férias", () => {
    const paos = [emp(1, "Rafael"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const firstHalfVacation = Array.from({ length: 15 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return { employeeUuid: "uuid-1", date: `2026-07-${day}` };
    });
    const input = baseInput(paos, {
      fcfRules: [{ employeeUuid: "uuid-1", shiftCode: "T9", weekday: 4 }],
      vacationDays: firstHalfVacation,
    });
    const result = generateCleanSchedule(input, motorOpts);
    expect(
      result.assignments.find((a) => a.employeeUuid === "uuid-1" && a.date === "2026-07-02"),
    ).toBeUndefined();
    expect(
      result.assignments.find((a) => a.employeeUuid === "uuid-1" && a.date === "2026-07-16")?.shiftCode,
    ).toBe("T9");
    expect(
      result.assignments.find((a) => a.employeeUuid === "uuid-1" && a.date === "2026-07-23")?.shiftCode,
    ).toBe("T9");
  });
});
