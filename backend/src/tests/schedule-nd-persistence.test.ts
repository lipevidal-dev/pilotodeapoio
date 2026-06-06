import { describe, expect, it } from "vitest";
import { GenerateScheduleUseCase } from "../application/use-cases/generate-schedule.use-case.js";
import { addDays } from "../domain/rules/dates.js";
import { MOTOR_VERSION_ID } from "../domain/schedule/real-schedule-types.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { minimalPaoInput } from "./generation-fixtures.js";
import { compareEmployeesBySeniority } from "../domain/employee/seniority.js";

type PersistedAssignment = {
  employeeId: string;
  date: Date;
  shiftCode: string;
  label: string | null;
  source: string;
};

type PersistedPreAllocation = {
  employeeId: string;
  date: Date;
  label: string;
};

function isoDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function assertT8PairsHaveNdInPersisted(
  assignments: PersistedAssignment[],
  preAllocations: PersistedPreAllocation[],
): void {
  const byEmpDay = new Map<string, string>();
  for (const a of assignments) {
    if (a.shiftCode === "T8") {
      byEmpDay.set(`${a.employeeId}|${isoDateKey(a.date)}`, "T8");
    }
  }

  const ndSet = new Set(
    preAllocations
      .filter((p) => p.label.toUpperCase() === "ND")
      .map((p) => `${p.employeeId}|${isoDateKey(p.date)}`),
  );

  for (const [key, code] of byEmpDay) {
    if (code !== "T8") continue;
    const [empId, day] = key.split("|") as [string, string];
    const next = addDays(day, 1);
    const nextKey = `${empId}|${next}`;
    if (byEmpDay.get(nextKey) !== "T8") continue;
    const ndDay = addDays(next, 1);
    const ndKey = `${empId}|${ndDay}`;
    expect(ndSet.has(ndKey), `ND ausente após T8/T8 ${day}/${next} para ${empId} (persistido)`).toBe(
      true,
    );
  }
}

describe("T8/T8/ND — persistência integrada", () => {
  it("gerar → persistir → buscar mês confirma ND no JSON persistido", async () => {
    const input = minimalPaoInput(4);
    const employees = input.employees
      .map((e) => ({
        id: e.uuid,
        name: e.employee.name,
        type: e.employee.role,
        roleId: e.employee.role === "PAO" ? "role-pao" : "role-apao",
        seniorityNumber: e.employee.seniority,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      .sort(compareEmployeesBySeniority);

    let savedAssignments: PersistedAssignment[] = [];
    let savedPreAllocations: PersistedPreAllocation[] = [];

    const shifts = input.shifts.map((s, i) => ({
      id: `shift-${s.code.toLowerCase()}`,
      code: s.code,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      durationHours: 8,
      employeeTypeAllowed: s.role === "APAO" ? "APAO" : "PAO",
      active: true,
      displayOrder: i + 1,
      mandatoryCoverage: ["T6", "T7", "T8"].includes(s.code),
      requiresT8PairNd: s.code === "T8",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const useCase = new GenerateScheduleUseCase(
      {
        findMonth: async () => null,
        listActiveEmployees: async () => employees,
        listShifts: async () => shifts,
        listRoles: async () => [],
        loadCrossMonthHistory: async () => ({ assignments: [], allocations: [] }),
        listShiftRestrictionsForMonth: async () => [],
        listNoFlightDatesForMonth: async () => [],
        upsertGeneratedMonth: async () => ({
          id: "month-nd-1",
          year: 2026,
          month: 6,
          status: "GENERATED",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        clearForRegeneration: async () => {
          savedAssignments = [];
          savedPreAllocations = [];
        },
        saveAssignments: async (
          _id: string,
          rows: Array<{ employeeUuid: string; date: string; shiftCode: string }>,
        ) => {
          savedAssignments = rows.map((r) => ({
            employeeId: r.employeeUuid,
            date: new Date(`${r.date}T12:00:00.000Z`),
            shiftCode: r.shiftCode,
            label: null,
            source: "GENERATOR",
          }));
        },
        saveGeneratedPreAllocations: async (
          _id: string,
          rows: Array<{ employeeUuid: string; date: string; label: string }>,
        ) => {
          savedPreAllocations = rows.map((r) => ({
            employeeId: r.employeeUuid,
            date: new Date(`${r.date}T12:00:00.000Z`),
            label: r.label,
          }));
        },
        saveViolations: async () => {},
      } as never,
      {
        listVacationDaysForMonth: async () => [],
        listVacationReturnDaysForMonth: async () => [],
        listApprovedDayOffForMonth: async () => [],
        listFlightDaysForMonth: async () => [],
      } as never,
      { findAll: async () => [] } as never,
    );

    const generated = await useCase.execute(2026, 6);

    expect(generated.motorVersion).toBe(MOTOR_VERSION_ID);
    expect(generated.realEngineExecuted).toBe(true);
    expect(generated.summary.realEngineExecuted).toBe(true);
    const report = generated.summary.realMotorReport as {
      structuralMetrics?: { t8IsolatedCount: number; t8PairsWithoutNdCount: number };
      t8IsolatedCount?: number;
      t8PairsWithoutNdCount?: number;
    };
    expect(report.t8IsolatedCount ?? report.structuralMetrics?.t8IsolatedCount ?? 0).toBe(0);
    expect(report.t8PairsWithoutNdCount ?? report.structuralMetrics?.t8PairsWithoutNdCount ?? 0).toBe(
      0,
    );

    const monthPayload = {
      assignments: savedAssignments,
      preAllocations: savedPreAllocations,
    };

    expect(savedPreAllocations.some((p) => p.label === "ND")).toBe(true);
    assertT8PairsHaveNdInPersisted(monthPayload.assignments, monthPayload.preAllocations);
  });

  it("PAO sem voo + restrição T8: diagnóstico no realMotorReport", async () => {
    const input = minimalPaoInput(4);
    const uuid = input.employees[0]!.uuid;
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `2026-06-${d}`;
    });

    const employees = input.employees.map((e) => ({
      id: e.uuid,
      name: e.employee.name,
      type: e.employee.role,
      roleId: e.employee.role === "PAO" ? "role-pao" : "role-apao",
      seniorityNumber: e.employee.seniority,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const shifts = input.shifts.map((s, i) => ({
      id: `shift-${s.code.toLowerCase()}`,
      code: s.code,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      durationHours: 8,
      employeeTypeAllowed: s.role === "APAO" ? "APAO" : "PAO",
      active: true,
      displayOrder: i + 1,
      mandatoryCoverage: ["T6", "T7", "T8"].includes(s.code),
      requiresT8PairNd: s.code === "T8",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const useCase = new GenerateScheduleUseCase(
      {
        findMonth: async () => null,
        listActiveEmployees: async () => employees,
        listShifts: async () => shifts,
        listRoles: async () => [],
        loadCrossMonthHistory: async () => ({ assignments: [], allocations: [] }),
        listShiftRestrictionsForMonth: async () => [
          { employeeUuid: uuid, shiftCode: "T8" },
        ],
        listNoFlightDatesForMonth: async () =>
          days.map((date) => ({ employeeUuid: uuid, date })),
        upsertGeneratedMonth: async () => ({ id: "month-2" }),
        clearForRegeneration: async () => {},
        saveAssignments: async () => {},
        saveGeneratedPreAllocations: async () => {},
        saveViolations: async () => {},
      } as never,
      {
        listVacationDaysForMonth: async () => [],
        listVacationReturnDaysForMonth: async () => [],
        listApprovedDayOffForMonth: async () => [],
        listFlightDaysForMonth: async () => [],
      } as never,
      { findAll: async () => [] } as never,
    );

    const generated = await useCase.execute(2026, 6);
    const report = generated.summary.realMotorReport as {
      employeeDiagnostics?: Array<{
        employeeUuid: string;
        noFlightFullMonth: boolean;
        restrictedShiftCodes: string[];
        t6Count: number;
        t7Count: number;
        t8Count: number;
        flightCount: number;
        targetWorkdays: number;
        actualWorkdays: number;
        failedAllocationReasons: string[];
      }>;
    };

    const diag = report.employeeDiagnostics?.find((d) => d.employeeUuid === uuid);
    expect(diag).toBeDefined();
    expect(diag!.noFlightFullMonth).toBe(true);
    expect(diag!.restrictedShiftCodes).toContain("T8");
    expect(diag!.t8Count).toBe(0);
    expect(diag!.flightCount).toBe(0);
    expect(diag!.targetWorkdays).toBe(20);
    expect(diag!.t6Count + diag!.t7Count).toBeGreaterThan(0);
    if (diag!.actualWorkdays < 20) {
      expect(diag!.failedAllocationReasons.length).toBeGreaterThan(0);
      expect(
        diag!.failedAllocationReasons.some((r) => r.includes("Restrição T8") || r.includes("Déficit")),
      ).toBe(true);
    } else {
      expect(diag!.actualWorkdays).toBeGreaterThanOrEqual(20);
    }
    expect(buildShiftRestrictionMap(input.employees, [{ employeeUuid: uuid, shiftCode: "T8" }])).toBeDefined();
  });
});
