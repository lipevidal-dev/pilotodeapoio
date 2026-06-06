import { describe, expect, it, vi } from "vitest";
import { ManualScheduleEditUseCase } from "../application/use-cases/manual-schedule-edit.use-case.js";
import { ManualEditBlockedError } from "../application/errors/manual-edit.errors.js";
import {
  buildManualEditValidationContext,
  validateManualSet,
  validateManualMove,
} from "../domain/schedule/manual-edit-validator.js";
import { buildContextFromDbParts } from "../infrastructure/mappers/schedule-context.mapper.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";

const EMP_A = "11111111-1111-1111-1111-111111111101";
const EMP_B = "11111111-1111-1111-1111-111111111102";
const MONTH_ID = "month-manual-1";

function baseValidationCtx() {
  const employees = [
    { id: EMP_A, name: "PAO Alpha", role: "PAO" },
    { id: EMP_B, name: "PAO Beta", role: "PAO" },
  ];
  const shifts = DEFAULT_SHIFTS.map((s, i) => ({
    id: `s-${i}`,
    code: s.code,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    durationHours: 8,
    employeeTypeAllowed: s.role,
    active: true,
    displayOrder: i,
    mandatoryCoverage: true,
    requiresT8PairNd: s.code === "T8",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  const ctx = buildContextFromDbParts({
    year: 2026,
    month: 7,
    employees: employees.map((e, i) => ({
      id: e.id,
      name: e.name,
      type: e.role as "PAO",
      roleId: "role-pao",
      seniorityNumber: i + 1,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never,
    shifts: shifts as never,
    assignments: [
      {
        id: "a1",
        scheduleMonthId: MONTH_ID,
        employeeId: EMP_A,
        date: new Date("2026-07-02T12:00:00.000Z"),
        shiftCode: "T6",
        label: null,
        source: "GENERATOR",
        createdAt: new Date(),
        updatedAt: new Date(),
        employee: { id: EMP_A, name: "PAO Alpha", type: "PAO" } as never,
      },
    ],
    preAllocations: [],
  });

  return buildManualEditValidationContext({
    ctx,
    employees,
    shiftRestrictionRows: [{ employeeUuid: EMP_B, shiftCode: "T8" }],
    noFlightDates: Array.from({ length: 31 }, (_, i) => ({
      employeeUuid: EMP_B,
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    })),
    vacationDays: [],
    approvedDayOff: [],
    assignments: [{ employeeId: EMP_A, date: "2026-07-02", shiftCode: "T6" }],
    preAllocations: [],
    flightDays: [],
  });
}

describe("manual-edit-validator", () => {
  it("1. bloqueia VOO para funcionário com não alocar voos mês inteiro", () => {
    const v = baseValidationCtx();
    const conflicts = validateManualSet(v, { employeeId: EMP_B, date: "2026-07-15" }, "VOO");
    expect(conflicts.some((c) => c.code === "NO_FLIGHT_MONTH")).toBe(true);
  });

  it("2. bloqueia turno restrito", () => {
    const v = baseValidationCtx();
    const conflicts = validateManualSet(v, { employeeId: EMP_B, date: "2026-07-10" }, "T8");
    expect(conflicts.some((c) => c.code === "SHIFT_RESTRICTED")).toBe(true);
  });

  it("6. bloqueia mover T6 para dia já ocupado", () => {
    const v = baseValidationCtx();
    v.occupancy.set(`${EMP_B}|2026-07-05`, {
      shiftCode: "T7",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    const conflicts = validateManualMove(
      v,
      { employeeId: EMP_A, date: "2026-07-02" },
      { employeeId: EMP_B, date: "2026-07-05" },
    );
    expect(conflicts.some((c) => c.code === "TARGET_OCCUPIED" || c.code === "CANNOT_WORK")).toBe(
      true,
    );
  });

  it("7. bloqueia T8 se quebrar bloco T8/T8/ND", () => {
    const v = baseValidationCtx();
    v.occupancy.set(`${EMP_A}|2026-07-10`, {
      shiftCode: "T8",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    v.occupancy.set(`${EMP_A}|2026-07-11`, {
      shiftCode: "T8",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    v.occupancy.set(`${EMP_A}|2026-07-12`, {
      preallocLabel: "ND",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    const conflicts = validateManualSet(
      v,
      { employeeId: EMP_A, date: "2026-07-12" },
      "CLEAR",
    );
    expect(conflicts.some((c) => c.code === "PROTECTED_ND" || c.code === "PROTECTED_T8_BLOCK")).toBe(
      true,
    );
  });
});

describe("ManualScheduleEditUseCase", () => {
  const monthRecord = {
    id: MONTH_ID,
    year: 2026,
    month: 7,
    status: "GENERATED",
    createdAt: new Date(),
    updatedAt: new Date(),
    assignments: [],
    preAllocations: [],
  };

  function buildUseCase(overrides?: {
    applyAllocationType?: ReturnType<typeof vi.fn>;
    clearDay?: ReturnType<typeof vi.fn>;
  }) {
    const applyAllocationType = overrides?.applyAllocationType ?? vi.fn(async () => ({}));
    const clearDay = overrides?.clearDay ?? vi.fn(async () => undefined);

    return new ManualScheduleEditUseCase(
      {
        findMonthById: async () => ({
          ...monthRecord,
          assignments: [],
          preAllocations: [],
        }),
        applyAllocationType,
        clearDay,
        upsertShiftAssignment: vi.fn(),
        upsertPreAllocation: vi.fn(),
        upsertFlight: vi.fn(),
        formatAssignmentDate: (d: Date) => d.toISOString().slice(0, 10),
      } as never,
      {
        listActiveEmployees: async () => [
          { id: EMP_A, name: "PAO Alpha", type: "PAO", seniorityNumber: 1, active: true },
          { id: EMP_B, name: "PAO Beta", type: "PAO", seniorityNumber: 2, active: true },
        ],
        listShifts: async () => DEFAULT_SHIFTS.map((s, i) => ({
          id: `s-${i}`,
          code: s.code,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          durationHours: 8,
          employeeTypeAllowed: s.role,
          active: true,
          displayOrder: i,
          mandatoryCoverage: true,
          requiresT8PairNd: s.code === "T8",
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        listShiftRestrictionsForMonth: async () => [{ employeeUuid: EMP_B, shiftCode: "T8" }],
        listNoFlightDatesForMonth: async () =>
          Array.from({ length: 31 }, (_, i) => ({
            employeeUuid: EMP_B,
            date: `2026-07-${String(i + 1).padStart(2, "0")}`,
          })),
        saveViolations: async () => undefined,
        findMonthById: async () => ({
          ...monthRecord,
          assignments: [],
          preAllocations: [],
          ruleViolations: [],
        }),
      } as never,
      {
        listVacationDaysForMonth: async () => [],
        listApprovedDayOffForMonth: async () => [],
        listFlightDaysForMonth: async () => [],
      } as never,
      {
        getOperationalCadastrosForMonth: async () => [],
      } as never,
      {
        execute: () => ({
          valid: true,
          violations: [],
          summary: { total: 0, critica: 0, alta: 0, media: 0, baixa: 0 },
        }),
      } as never,
    );
  }

  it("3. aplica FOLGA em período", async () => {
    const apply = vi.fn(async () => ({}));
    const uc = buildUseCase({ applyAllocationType: apply });
    const result = await uc.editRange(MONTH_ID, {
      employeeId: EMP_A,
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      type: "FOLGA",
      mode: "set",
    });
    expect(result.applied).toBe(3);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("4. limpa período", async () => {
    const clear = vi.fn(async () => undefined);
    const uc = buildUseCase({ clearDay: clear });
    const result = await uc.editRange(MONTH_ID, {
      employeeId: EMP_A,
      startDate: "2026-07-05",
      endDate: "2026-07-06",
      type: "FOLGA",
      mode: "clear",
    });
    expect(result.applied).toBe(2);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("2. bloqueia VOO no use-case", async () => {
    const uc = buildUseCase();
    await expect(
      uc.editCell(MONTH_ID, {
        employeeId: EMP_B,
        date: "2026-07-10",
        type: "VOO",
        mode: "set",
      }),
    ).rejects.toBeInstanceOf(ManualEditBlockedError);
  });

  it("10. não regenera escala — retorna payload atualizado", async () => {
    const uc = buildUseCase();
    const result = await uc.editCell(MONTH_ID, {
      employeeId: EMP_A,
      date: "2026-07-20",
      type: "FOLGA",
      mode: "set",
    });
    expect(result.assignments).toBeDefined();
    expect(result.validation).toBeDefined();
    expect(result.operationalCadastros).toBeDefined();
  });
});
