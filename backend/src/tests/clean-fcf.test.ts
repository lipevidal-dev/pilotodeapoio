import { describe, expect, it } from "vitest";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
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
  ];
}

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
    ).toBe(true);
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
});
