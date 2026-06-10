import { describe, expect, it, vi } from "vitest";
import { ManualScheduleEditUseCase } from "../application/use-cases/manual-schedule-edit.use-case.js";
import { ManualEditBlockedError } from "../application/errors/manual-edit.errors.js";
import {
  buildManualEditValidationContext,
  validateManualSet,
  validateManualMove,
  validateManualT8BlockSet,
} from "../domain/schedule/manual-edit-validator.js";
import { buildContextFromDbParts } from "../infrastructure/mappers/schedule-context.mapper.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";

const EMP_A = "11111111-1111-1111-1111-111111111101";
const EMP_B = "11111111-1111-1111-1111-111111111102";
const EMP_C = "11111111-1111-1111-1111-111111111103";
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

  const { context: ctx, uuidToDomainId } = buildContextFromDbParts({
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
    uuidToDomainId,
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
    const occupied = conflicts.find((c) => c.code === "TARGET_OCCUPIED");
    expect(occupied?.message).toContain("T7");
  });

  it("3. não bloqueia mover turno quando outro PAO já cobre o dia (responsabilidade do motor)", () => {
    const v = baseValidationCtx();
    v.occupancy.set(`${EMP_A}|2026-07-10`, {
      shiftCode: "T6",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    const conflicts = validateManualMove(
      v,
      { employeeId: EMP_A, date: "2026-07-02" },
      { employeeId: EMP_B, date: "2026-07-10" },
    );
    expect(conflicts.some((c) => c.code === "SHIFT_COVERAGE")).toBe(false);
  });

  it("3c. permite mover turno sobre VOO em preAllocation (célula aparentemente vazia)", () => {
    const v = baseValidationCtx();
    v.occupancy.set(`${EMP_A}|2026-07-10`, {
      preallocLabel: "VOO",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    const conflicts = validateManualMove(
      v,
      { employeeId: EMP_A, date: "2026-07-02" },
      { employeeId: EMP_A, date: "2026-07-10" },
    );
    expect(conflicts.some((c) => c.code === "CANNOT_WORK" && c.message.includes("VOO"))).toBe(
      false,
    );
    expect(conflicts.some((c) => c.code === "TARGET_OCCUPIED")).toBe(false);
  });

  it("3d. permite mover VOO manual em preAllocation", () => {
    const v = baseValidationCtx();
    v.occupancy.set(`${EMP_A}|2026-07-02`, {
      preallocLabel: "VOO",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    });
    const conflicts = validateManualMove(
      v,
      { employeeId: EMP_A, date: "2026-07-02" },
      { employeeId: EMP_A, date: "2026-07-15" },
    );
    expect(conflicts.some((c) => c.code === "EMPTY_SOURCE")).toBe(false);
    expect(conflicts.some((c) => c.code === "NO_FLIGHT_MONTH")).toBe(false);
  });

  it("3e. APAO com Role APAO não é tratado como PAO ao alocar T4", () => {
    const EMP_APAO = "11111111-1111-1111-1111-111111111199";
    const shifts = DEFAULT_SHIFTS.map((s, i) => ({
      id: `s-${i}`,
      code: s.code,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      durationHours: 8,
      employeeTypeAllowed: s.role === "APAO" ? "APAO" : "PAO",
      active: true,
      displayOrder: i,
      mandatoryCoverage: true,
      requiresT8PairNd: s.code === "T8",
      coverageType: "REQUIRED" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const { context: ctx, uuidToDomainId } = buildContextFromDbParts({
      year: 2026,
      month: 6,
      employees: [
        {
          id: EMP_APAO,
          name: "Lucas Bulgare",
          type: "PAO",
          roleId: "role-apao",
          seniorityNumber: 1,
          active: true,
          birthDate: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          role: {
            id: "role-apao",
            name: "APAO",
            code: "APAO",
            description: null,
            active: true,
            displayOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        } as never,
      ],
      shifts: shifts as never,
      assignments: [
        {
          id: "a-apao",
          scheduleMonthId: MONTH_ID,
          employeeId: EMP_APAO,
          date: new Date("2026-06-01T12:00:00.000Z"),
          shiftCode: "T1",
          label: null,
          source: "GENERATOR",
          createdAt: new Date(),
          updatedAt: new Date(),
          employee: {
            id: EMP_APAO,
            name: "Lucas Bulgare",
            type: "PAO",
            roleId: "role-apao",
            seniorityNumber: 1,
            active: true,
            birthDate: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never,
        },
      ],
      preAllocations: [],
    });

    const domainApao = ctx.employees.find((e) => e.name === "Lucas Bulgare");
    expect(domainApao?.role).toBe("APAO");

    const v = buildManualEditValidationContext({
      ctx,
      uuidToDomainId,
      employees: [
        {
          id: EMP_APAO,
          name: "Lucas Bulgare",
          role: "APAO",
          seniorityNumber: 1,
        },
      ],
      shiftRestrictionRows: [],
      noFlightDates: [],
      vacationDays: [],
      approvedDayOff: [],
      assignments: [{ employeeId: EMP_APAO, date: "2026-06-01", shiftCode: "T1" }],
      preAllocations: [],
      flightDays: [],
    });

    const conflicts = validateManualSet(
      v,
      { employeeId: EMP_APAO, date: "2026-06-02" },
      "T4",
    );
    expect(
      conflicts.some((c) => c.message.includes("PAO não pode assumir turno de APAO")),
    ).toBe(false);
    expect(
      conflicts.some((c) => c.message.includes("APAO sem PAO cobrindo o turno")),
    ).toBe(false);
  });

  it("6b. permite alocar dia antes do bloco T8/T8/ND", () => {
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
      { employeeId: EMP_A, date: "2026-07-09" },
      "T6",
    );
    expect(conflicts.some((c) => c.code === "PROTECTED_T8_BLOCK")).toBe(false);
  });

  it("8. edição manual não bloqueia por limite de 2 estações simultâneas", () => {
    const v = baseValidationCtx();
    v.idByUuid.set(EMP_C, 3);
    v.uuidById.set(3, EMP_C);
    v.nameByUuid.set(EMP_C, "PAO Gamma");
    v.scheduleContext.employees.push({
      id: 3,
      name: "PAO Gamma",
      role: "PAO",
      seniority: 3,
      active: true,
    });
    const occ = {
      shiftCode: "T6",
      hasFlight: false,
      hasVacation: false,
      hasRequestedOff: false,
    };
    v.occupancy.set(`${EMP_A}|2026-07-10`, occ);
    v.occupancy.set(`${EMP_B}|2026-07-10`, occ);
    const conflicts = validateManualSet(
      v,
      { employeeId: EMP_C, date: "2026-07-10" },
      "T6",
    );
    expect(conflicts.some((c) => c.message.includes("estações simultâneas"))).toBe(false);
  });

  it("9a. alocar T8 isolado (manual) não exige bloco T8/T8/ND", () => {
    const v = baseValidationCtx();
    const conflicts = validateManualSet(v, { employeeId: EMP_A, date: "2026-07-15" }, "T8");
    expect(conflicts.some((c) => c.code === "T8_BLOCK_INCOMPLETE")).toBe(false);
    expect(conflicts.some((c) => c.code === "PROTECTED_T8_BLOCK")).toBe(false);
  });

  it("9. alocar T8_BLOCK cria bloco T8/T8/ND sem PROTECTED_T8_BLOCK", () => {
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
    const conflicts = validateManualT8BlockSet(v, EMP_A, "2026-07-15");
    expect(conflicts.some((c) => c.code === "PROTECTED_T8_BLOCK")).toBe(false);
    expect(conflicts.some((c) => c.code === "PROTECTED_ND")).toBe(false);
  });

  it("9b. mover T8 realoca bloco inteiro no destino", () => {
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
    const conflicts = validateManualMove(
      v,
      { employeeId: EMP_A, date: "2026-07-11" },
      { employeeId: EMP_A, date: "2026-07-20" },
    );
    expect(conflicts.some((c) => c.code === "PROTECTED_T8_BLOCK")).toBe(false);
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
        listShifts: async () => [
          ...DEFAULT_SHIFTS.map((s, i) => ({
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
            coverageType: "REQUIRED" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          {
            id: "s-t9",
            code: "T9",
            name: "Turno 9 PAO",
            startTime: "10:00",
            endTime: "18:00",
            durationHours: 8,
            employeeTypeAllowed: "PAO",
            active: true,
            displayOrder: 9,
            mandatoryCoverage: false,
            requiresT8PairNd: false,
            coverageType: "PARALLEL" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        listShiftRestrictionsForMonth: async () => [{ employeeUuid: EMP_B, shiftCode: "T8" }],
        listPreferredShiftsForMonth: async () => [{ employeeUuid: EMP_A, shiftCode: "T9" }],
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

  it("1. manual-move retorna conflito com mensagem específica", async () => {
    const uc = buildUseCase();
    try {
      await uc.moveCell(MONTH_ID, {
        source: { employeeId: EMP_A, date: "2026-07-02" },
        target: { employeeId: EMP_B, date: "2026-07-05" },
        mode: "move",
      });
      expect.fail("deveria bloquear");
    } catch (err) {
      expect(err).toBeInstanceOf(ManualEditBlockedError);
      const blocked = err as ManualEditBlockedError;
      expect(blocked.message.length).toBeGreaterThan(10);
      expect(blocked.conflicts[0]?.message).toContain("Conflito");
    }
  });

  it("2. manual-range retorna conflito com mensagem específica", async () => {
    const uc = buildUseCase();
    try {
      await uc.editRange(MONTH_ID, {
        employeeId: EMP_B,
        startDate: "2026-07-10",
        endDate: "2026-07-10",
        type: "VOO",
        mode: "set",
      });
      expect.fail("deveria bloquear");
    } catch (err) {
      expect(err).toBeInstanceOf(ManualEditBlockedError);
      expect((err as ManualEditBlockedError).conflicts[0]?.code).toBe("NO_FLIGHT_MONTH");
    }
  });

  it("10a. T8 isolado aplica somente um dia", async () => {
    const apply = vi.fn(async () => ({}));
    const uc = buildUseCase({ applyAllocationType: apply });
    const result = await uc.editCell(MONTH_ID, {
      employeeId: EMP_A,
      date: "2026-07-20",
      type: "T8",
      mode: "set",
    });
    expect(result.applied).toBe(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(MONTH_ID, EMP_A, "2026-07-20", "T8");
  });

  it("10a2. T9 paralelo aplica assignment de turno", async () => {
    const apply = vi.fn(async () => ({}));
    const uc = buildUseCase({ applyAllocationType: apply });
    const result = await uc.editCell(MONTH_ID, {
      employeeId: EMP_A,
      date: "2026-07-18",
      type: "T9",
      mode: "set",
    });
    expect(result.applied).toBe(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(MONTH_ID, EMP_A, "2026-07-18", "T9");
  });

  it("10b. T8_BLOCK aplica bloco T8/T8/ND", async () => {
    const apply = vi.fn(async () => ({}));
    const clear = vi.fn(async () => undefined);
    const uc = buildUseCase({ applyAllocationType: apply, clearDay: clear });
    const result = await uc.editCell(MONTH_ID, {
      employeeId: EMP_A,
      date: "2026-07-20",
      type: "T8_BLOCK",
      mode: "set",
    });
    expect(result.applied).toBe(3);
    expect(apply).toHaveBeenCalledWith(MONTH_ID, EMP_A, "2026-07-20", "T8");
    expect(apply).toHaveBeenCalledWith(MONTH_ID, EMP_A, "2026-07-21", "T8");
    expect(apply).toHaveBeenCalledWith(MONTH_ID, EMP_A, "2026-07-22", "ND");
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
