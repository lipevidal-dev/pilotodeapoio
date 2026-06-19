import { describe, expect, it } from "vitest";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
import { tryAssignT8CoverageGap, tryPlaceT8Block, isBlockedByT8SpacingOnly, removeIsolatedT8ForPreferredPaos } from "../domain/schedule/clean-engine/clean-t8-blocks.js";
import { CROSS_MONTH_ND_LABEL } from "../domain/schedule/operational-labels.js";
import { CleanWorkspace } from "../domain/schedule/clean-engine/clean-workspace.js";
import { finalizeCrossMonthContinuations } from "../domain/schedule/clean-engine/clean-cross-month-continuity.js";
import { validateCleanGenerationBeforeSave, filterPersistenceBlockingIssues } from "../domain/schedule/clean-engine/clean-validator.js";
import { MOTOR_VERSION_CLEAN, MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import { paoShiftParamId } from "../domain/schedule/next-motor/next-motor-shift-params.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";

function emp(id: number, name: string, role: Employee["role"] = "PAO", seniority = id): GenerationInputEmployee {
  const employee: Employee = { id, name, role, seniority };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function baseShifts(): Shift[] {
  return [
    { code: "T6", startTime: "06:00", endTime: "14:00", role: "PAO", active: true },
    { code: "T7", startTime: "14:00", endTime: "22:00", role: "PAO", active: true },
    { code: "T8", startTime: "22:00", endTime: "06:00", role: "PAO", active: true },
  ];
}

function baseInput(paos: GenerationInputEmployee[]): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees: paos,
    shifts: baseShifts(),
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
  };
}

describe("CleanEngine", () => {
  it("retorna erro claro sem PAO cadastrado", () => {
    const result = generateCleanSchedule(baseInput([]));
    expect(result.success).toBe(false);
    expect(result.violations.some((v) => v.type === "NO_PAO_REGISTERED")).toBe(true);
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_CLEAN);
  });

  it("gera cobertura T6/T7/T8 com PAOs suficientes", () => {
    const paos = [emp(1, "Ana"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    const result = generateCleanSchedule(baseInput(paos));
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_CLEAN);
    expect(result.summary.coverageGaps).toBe(0);
    const save = validateCleanGenerationBeforeSave(baseInput(paos), result);
    expect(save.criticalCount).toBe(0);
  });

  it("registra falha de cobertura na auditoria quando PAOs insuficientes", () => {
    const paos = [emp(1, "Ana")];
    const result = generateCleanSchedule(baseInput(paos));
    expect(result.success).toBe(false);
    expect(result.summary.coverageGaps).toBeGreaterThan(0);
    expect(result.violations.some((v) => v.type === "COVERAGE_GAP")).toBe(true);
    const report = result.summary.realMotorReport as { coverageFailures?: number };
    expect(report.coverageFailures).toBeGreaterThan(0);
  });

  it("respeita escopo de funcionários do motor NEXT", () => {
    const paos = [emp(1, "Ana"), emp(2, "Bruno"), emp(3, "Carla"), emp(4, "Diego")];
    paos[0]!.uuid = "uuid-1";
    paos[1]!.uuid = "uuid-2";
    paos[2]!.uuid = "uuid-3";
    paos[3]!.uuid = "uuid-4";
    const result = generateCleanSchedule(baseInput(paos), {
      scopeEmployeeUuids: ["uuid-1", "uuid-2"],
      motorVersion: "NEXT",
    });
    const used = new Set(result.assignments.map((a) => a.employeeUuid));
    expect(used.size).toBeLessThanOrEqual(2);
    for (const u of used) {
      expect(["uuid-1", "uuid-2"]).toContain(u);
    }
  });

  it("PAO T8 preferido recebe blocos T8/T8/ND e não T6", () => {
    const paos = [
      emp(1, "Palombino"),
      emp(2, "Bruno"),
      emp(3, "Carla"),
      emp(4, "Diego"),
    ];
    paos[0]!.uuid = "uuid-palombino";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-palombino"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6", "T7", "T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        t8_t8_nd: true,
        coverage_t6: true,
        coverage_t7: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 9, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);
    const pal = result.assignments.filter((a) => a.employeeUuid === "uuid-palombino");
    expect(pal.some((a) => a.shiftCode.toUpperCase() === "T6")).toBe(false);
    expect(pal.some((a) => a.shiftCode.toUpperCase() === "T7")).toBe(false);
    expect(pal.every((a) => a.shiftCode.toUpperCase() === "T8")).toBe(true);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === "uuid-palombino" && a.label.toUpperCase() === "ND",
      ),
    ).toBe(true);
    const blockers = filterPersistenceBlockingIssues(
      validateCleanGenerationBeforeSave(input, result, options).issues,
      options,
    );
    expect(blockers.some((b) => b.type === "T8_WITHOUT_ND")).toBe(false);
  });

  it("respeita preferência T8 e meta de turnos do motor", () => {
    const paos = [
      emp(1, "Palombino"),
      emp(2, "Bruno"),
      emp(3, "Carla"),
      emp(4, "Diego"),
    ];
    paos[0]!.uuid = "uuid-palombino";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-palombino"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6", "T7", "T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        coverage_t6: true,
        coverage_t7: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 9, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);
    const palombinoShifts = result.assignments
      .filter((a) => a.employeeUuid === "uuid-palombino")
      .map((a) => a.shiftCode.toUpperCase());
    expect(palombinoShifts.length).toBeGreaterThan(0);
    expect(palombinoShifts.every((c) => c === "T8")).toBe(true);
    expect(palombinoShifts.length).toBeLessThanOrEqual(9);
  });

  it("T8 preferido: bloco T8/T8/ND com 4 dias livres entre blocos", () => {
    const paos = [
      emp(1, "Palombino"),
      emp(2, "Bruno"),
      emp(3, "Carla"),
      emp(4, "Diego"),
    ];
    paos[0]!.uuid = "uuid-palombino";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-palombino"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: { pao_meta_turnos: 6, pao_espacamento_turnos: 4, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);
    const palT8 = result.assignments
      .filter((a) => a.employeeUuid === "uuid-palombino" && a.shiftCode.toUpperCase() === "T8")
      .map((a) => a.date)
      .sort();
    expect(palT8.length).toBeGreaterThanOrEqual(4);
    expect(palT8[0]).toBe("2026-07-01");
    expect(palT8[1]).toBe("2026-07-02");
    expect(palT8[2]).toBe("2026-07-08");
    expect(palT8[3]).toBe("2026-07-09");
    const ndDays = result.allocations
      .filter((a) => a.employeeUuid === "uuid-palombino" && a.label.toUpperCase() === "ND")
      .map((a) => a.date)
      .sort();
    expect(ndDays).toContain("2026-07-03");
    expect(ndDays).toContain("2026-07-10");
  });

  it("dois PAO T8: senior com simulador dia 1 — junior cobre bloco 1-2/ND3", () => {
    const paos = [emp(1, "Senior"), emp(2, "Junior")];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
      lockedAllocations: [
        { employeeUuid: "uuid-senior", date: "2026-07-01", label: "SIMULADOR" },
      ],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: { pao_meta_turnos: 4, pao_espacamento_turnos: 4, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);

    const juniorT8 = result.assignments
      .filter((a) => a.employeeUuid === "uuid-junior" && a.shiftCode.toUpperCase() === "T8")
      .map((a) => a.date)
      .sort();
    const seniorT8 = result.assignments
      .filter((a) => a.employeeUuid === "uuid-senior" && a.shiftCode.toUpperCase() === "T8")
      .map((a) => a.date)
      .sort();
    const juniorNd = result.allocations
      .filter((a) => a.employeeUuid === "uuid-junior" && a.label.toUpperCase() === "ND")
      .map((a) => a.date);

    expect(juniorT8[0]).toBe("2026-07-01");
    expect(juniorT8[1]).toBe("2026-07-02");
    expect(juniorNd).toContain("2026-07-03");
    expect(seniorT8[0]).toBe("2026-07-03");
    expect(seniorT8[1]).toBe("2026-07-04");
    expect(seniorT8).not.toContain("2026-07-01");
  });

  it("dois PAO T8: round-robin — senior bloqueado cedo, junior preenche antes", () => {
    const paos = [emp(1, "Senior"), emp(2, "Junior")];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
      vacationDays: [
        "2026-07-01",
        "2026-07-02",
        "2026-07-03",
        "2026-07-04",
        "2026-07-05",
        "2026-07-06",
        "2026-07-07",
      ].map((date) => ({ employeeUuid: "uuid-senior", date })),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: { pao_meta_turnos: 4, pao_espacamento_turnos: 4, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);

    const juniorT8 = result.assignments
      .filter((a) => a.employeeUuid === "uuid-junior" && a.shiftCode.toUpperCase() === "T8")
      .map((a) => a.date)
      .sort();

    expect(juniorT8[0]).toBe("2026-07-01");
    expect(juniorT8[1]).toBe("2026-07-02");
  });

  it("dois PAO T8: mais antigo preenche antes, sem T8 no mesmo dia", () => {
    const paos = [emp(1, "Senior"), emp(2, "Junior"), emp(3, "Carla"), emp(4, "Diego")];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: { pao_meta_turnos: 4, pao_espacamento_turnos: 4, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);

    const seniorT8 = result.assignments
      .filter((a) => a.employeeUuid === "uuid-senior" && a.shiftCode.toUpperCase() === "T8")
      .map((a) => a.date)
      .sort();
    const juniorT8 = result.assignments
      .filter((a) => a.employeeUuid === "uuid-junior" && a.shiftCode.toUpperCase() === "T8")
      .map((a) => a.date)
      .sort();

    expect(seniorT8).toEqual(["2026-07-01", "2026-07-02", "2026-07-08", "2026-07-09"]);
    expect(juniorT8).toEqual(["2026-07-03", "2026-07-04", "2026-07-10", "2026-07-11"]);
    for (const day of seniorT8) {
      expect(juniorT8).not.toContain(day);
    }
  });

  it("dois PAO T8: respeita meta de turnos configurada no motor", () => {
    const paos = [emp(1, "Senior"), emp(2, "Junior")];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: { pao_meta_turnos: 6, pao_espacamento_turnos: 4, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);

    const countT8 = (uuid: string) =>
      result.assignments.filter(
        (a) => a.employeeUuid === uuid && a.shiftCode.toUpperCase() === "T8",
      ).length;

    expect(countT8("uuid-senior")).toBe(6);
    expect(countT8("uuid-junior")).toBe(6);
  });

  it("agrupamento parcial: senior recebe 1 dia antes do junior no mesmo turno", () => {
    const paos = [emp(1, "Senior", "PAO", 1), emp(2, "Junior", "PAO", 2)];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T6"])],
        [2, new Set(["T6"])],
      ]),
      lockedAllocations: [
        { employeeUuid: "uuid-senior", date: "2026-07-02", label: "FOLGA PEDIDA" },
        { employeeUuid: "uuid-senior", date: "2026-07-03", label: "FOLGA PEDIDA" },
        { employeeUuid: "uuid-senior", date: "2026-07-04", label: "FOLGA PEDIDA" },
      ],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        locked_preallocations: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: {
        pao_meta_turnos: 4,
        pao_espacamento_turnos: 0,
        [paoShiftParamId("agrupamento_turnos", "T6")]: 4,
      },
    };
    const result = generateCleanSchedule(input, options);

    expect(
      result.assignments.some(
        (a) =>
          a.employeeUuid === "uuid-senior" &&
          a.date === "2026-07-01" &&
          a.shiftCode.toUpperCase() === "T6",
      ),
    ).toBe(true);
    expect(
      result.assignments.some(
        (a) =>
          a.employeeUuid === "uuid-junior" &&
          a.date === "2026-07-01" &&
          a.shiftCode.toUpperCase() === "T6",
      ),
    ).toBe(false);
  });

  it("espaça turnos preferidos e pula dias já ocupados", () => {
    const paos = [emp(1, "Ana")];
    paos[0]!.uuid = "uuid-a";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([[1, new Set(["T6"])]]),
      vacationDays: [{ employeeUuid: "uuid-a", date: "2026-07-05" }],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-a"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        coverage_t6: false,
        coverage_t7: false,
        coverage_t8: false,
      },
      motorParams: {
        pao_meta_turnos: 3,
        pao_espacamento_turnos: 2,
        [paoShiftParamId("agrupamento_turnos", "T6")]: 1,
      },
    };
    const result = generateCleanSchedule(input, options);
    const dates = result.assignments
      .filter((a) => a.employeeUuid === "uuid-a")
      .map((a) => a.date)
      .sort();
    expect(dates).toEqual(["2026-07-01", "2026-07-04", "2026-07-08"]);
    expect(result.assignments.every((a) => a.shiftCode.toUpperCase() === "T6")).toBe(true);
  });

  it("apenas T8 habilitado: não aloca T6/T7", () => {
    const paos = [emp(1, "Senior"), emp(2, "Junior"), emp(3, "Carla"), emp(4, "Diego")];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T6"])],
      ]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      allowedShiftCodes: ["T8"],
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        coverage_t6: true,
        coverage_t7: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 4, pao_espacamento_turnos: 4, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);
    const codes = new Set(result.assignments.map((a) => a.shiftCode.toUpperCase()));
    expect(codes.has("T8")).toBe(true);
    expect(codes.has("T6")).toBe(false);
    expect(codes.has("T7")).toBe(false);
    expect(
      result.assignments.some((a) => a.employeeUuid === "uuid-junior" && a.shiftCode.toUpperCase() === "T6"),
    ).toBe(false);
  });

  it("Lucas T8: cobertura dia 9 realoca bloco 10-11 (pipeline completo)", () => {
    const paos = [
      emp(1, "Palombino"),
      emp(2, "Antonio"),
      emp(3, "Lucas Wiltgen"),
    ];
    paos[0]!.uuid = "uuid-pal";
    paos[1]!.uuid = "uuid-ant";
    paos[2]!.uuid = "uuid-luc";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
        [3, new Set(["T8"])],
      ]),
      lockedAllocations: [
        { employeeUuid: "uuid-pal", date: "2026-07-10", label: "FOLGA PEDIDA" },
        { employeeUuid: "uuid-pal", date: "2026-07-11", label: "FOLGA PEDIDA" },
      ],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-pal", "uuid-ant", "uuid-luc"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 4, pao_espacamento_turnos: 2, pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    // Simula estado real: Lucas já tem 5-6/ND7 e 10-11/ND12 antes da cobertura
    expect(tryPlaceT8Block(ws, "uuid-luc", "2026-07-05")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-ant", "2026-07-07")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-luc", "2026-07-10")).toBe(true);

    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(false);
    expect(tryAssignT8CoverageGap(ws, "2026-07-09")).toBe(true);
    expect(ws.getShiftOnDay(3, "2026-07-09")?.toUpperCase()).toBe("T8");
    expect(ws.getShiftOnDay(3, "2026-07-10")?.toUpperCase()).toBe("T8");
    expect(ws.getBlockLabel(3, "2026-07-11")?.toUpperCase()).toBe("ND");
    expect(ws.getShiftOnDay(3, "2026-07-12")).toBeUndefined();
    expect(ws.getBlockLabel(3, "2026-07-12")).toBeUndefined();
    const lucasNd = ws.toAllocations().filter(
      (a) => a.employeeUuid === "uuid-luc" && a.label.toUpperCase() === "ND",
    );
    expect(lucasNd.map((a) => a.date).sort()).toEqual(["2026-07-07", "2026-07-11"]);
  });

  it("Lucas T8: bloco completo 9-10/ND11 na cobertura (exceção espaçamento)", () => {
    const paos = [
      emp(1, "Palombino"),
      emp(2, "Antonio"),
      emp(3, "Lucas Wiltgen"),
    ];
    paos[0]!.uuid = "uuid-pal";
    paos[1]!.uuid = "uuid-ant";
    paos[2]!.uuid = "uuid-luc";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
        [3, new Set(["T8"])],
      ]),
      lockedAllocations: [
        { employeeUuid: "uuid-pal", date: "2026-07-10", label: "FOLGA PEDIDA" },
        { employeeUuid: "uuid-pal", date: "2026-07-11", label: "FOLGA PEDIDA" },
      ],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-pal", "uuid-ant", "uuid-luc"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 4, pao_espacamento_turnos: 2, pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    // Cenário dia 9: Lucas 5–6/ND7, Antonio 7–8/ND9, Palombino na meta (1–2 e 13–14)
    expect(tryPlaceT8Block(ws, "uuid-luc", "2026-07-05")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-ant", "2026-07-07")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-pal", "2026-07-01")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-pal", "2026-07-13")).toBe(true);

    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(false);
    expect(isBlockedByT8SpacingOnly(ws, "uuid-luc", "2026-07-09")).toBe(true);
    expect(tryAssignT8CoverageGap(ws, "2026-07-09")).toBe(true);
    expect(ws.getShiftOnDay(3, "2026-07-09")?.toUpperCase()).toBe("T8");
    expect(ws.getShiftOnDay(3, "2026-07-10")?.toUpperCase()).toBe("T8");
    expect(ws.getBlockLabel(3, "2026-07-11")?.toUpperCase()).toBe("ND");
    removeIsolatedT8ForPreferredPaos(ws);
    expect(ws.getShiftOnDay(3, "2026-07-09")?.toUpperCase()).toBe("T8");
    expect(ws.getShiftOnDay(3, "2026-07-10")?.toUpperCase()).toBe("T8");
    ws.applyT8NdRule();
    const ndDays = ws
      .toAllocations()
      .filter((a) => a.employeeUuid === "uuid-luc" && a.label.toUpperCase() === "ND")
      .map((a) => a.date);
    expect(ndDays.sort()).toEqual(["2026-07-07", "2026-07-11"]);
  });

  it("Palombino T8: dia 9 coberto com exceção após ND no dia 8 (espaçamento 2)", () => {
    const paos = [emp(1, "Palombino"), emp(2, "Antonio")];
    paos[0]!.uuid = "uuid-pal";
    paos[1]!.uuid = "uuid-ant";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
      lockedAllocations: [
        { employeeUuid: "uuid-ant", date: "2026-07-09", label: "SIMULADOR" },
        { employeeUuid: "uuid-ant", date: "2026-07-10", label: "SIMULADOR" },
      ],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-pal", "uuid-ant"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 20, pao_espacamento_turnos: 2, pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    expect(tryPlaceT8Block(ws, "uuid-pal", "2026-07-01")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-pal", "2026-07-06")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-ant", "2026-07-04")).toBe(true);

    expect(isBlockedByT8SpacingOnly(ws, "uuid-pal", "2026-07-09")).toBe(true);
    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(false);
    expect(tryAssignT8CoverageGap(ws, "2026-07-09")).toBe(true);
    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(true);
    expect(ws.getShiftOnDay(1, "2026-07-09")?.toUpperCase()).toBe("T8");
    expect(ws.getShiftOnDay(1, "2026-07-10")?.toUpperCase()).toBe("T8");
  });

  it("cobertura T8: exceção de espaçamento quando dia ficaria vazio", () => {
    const paos = [emp(1, "Senior"), emp(2, "Junior")];
    paos[0]!.uuid = "uuid-senior";
    paos[1]!.uuid = "uuid-junior";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
      lockedAllocations: [
        { employeeUuid: "uuid-junior", date: "2026-07-09", label: "SIMULADOR" },
        { employeeUuid: "uuid-junior", date: "2026-07-10", label: "SIMULADOR" },
      ],
    };
    const options = {
      scopeEmployeeUuids: ["uuid-senior", "uuid-junior"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 20, pao_espacamento_turnos: 2, pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    expect(tryPlaceT8Block(ws, "uuid-senior", "2026-07-01")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-senior", "2026-07-06")).toBe(true);

    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(false);
    expect(tryAssignT8CoverageGap(ws, "2026-07-09")).toBe(true);
    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(true);
    expect(
      ws.audit.all().some(
        (e) =>
          e.kind === "COVERAGE_ASSIGNED" &&
          e.reason.includes("exceção de espaçamento"),
      ),
    ).toBe(true);
  });

  it("aplica ND após T8/T8 mesmo se cobertura ocupou o dia do ND", () => {
    const paos = [emp(1, "Palombino")];
    paos[0]!.uuid = "uuid-p";
    const input: GenerationInput = {
      ...baseInput(paos),
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-p"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6", "T7", "T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        t8_t8_nd: true,
        coverage_t6: true,
        coverage_t7: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 9, pao_max_consecutivos: 6 },
    };
    const result = generateCleanSchedule(input, options);
    const blockers = filterPersistenceBlockingIssues(
      validateCleanGenerationBeforeSave(input, result, options).issues,
      options,
    );
    expect(blockers.some((b) => b.type === "T8_WITHOUT_ND")).toBe(false);
    const ndDays = result.allocations
      .filter((a) => a.employeeUuid === "uuid-p" && a.label.toUpperCase() === "ND")
      .map((a) => a.date);
    expect(ndDays.length).toBeGreaterThan(0);
  });

  it("motor NEXT não bloqueia persistência por furos de cobertura", () => {
    const paos = [emp(1, "Ana")];
    paos[0]!.uuid = "uuid-1";
    const input = baseInput(paos);
    const result = generateCleanSchedule(input, {
      scopeEmployeeUuids: ["uuid-1"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6", "T7", "T8"],
    });
    expect(result.summary.coverageGaps).toBeGreaterThan(0);
    const save = validateCleanGenerationBeforeSave(input, result, {
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6", "T7", "T8"],
    });
    expect(save.criticalCount).toBeGreaterThan(0);
    expect(
      filterPersistenceBlockingIssues(save.issues, { motorVersion: MOTOR_VERSION_NEXT }).length,
    ).toBe(0);
  });

  it("cobertura T8 fallback: PAO mais novo (maior antiguidade) recebe bloco", () => {
    const helio = emp(1, "Helio Junior", "PAO", 1);
    const gabriel = emp(2, "Gabriel Castanho", "PAO", 50);
    helio.uuid = "uuid-helio";
    gabriel.uuid = "uuid-gabriel";
    const preferred = emp(3, "Preferred Blocked", "PAO", 10);
    preferred.uuid = "uuid-pref";

    const input: GenerationInput = {
      year: 2026,
      month: 7,
      employees: [helio, gabriel, preferred],
      shifts: baseShifts(),
      lockedAllocations: [
        { employeeUuid: "uuid-pref", date: "2026-07-09", label: "SIMULADOR" },
        { employeeUuid: "uuid-pref", date: "2026-07-10", label: "SIMULADOR" },
      ],
      vacationDays: [],
      approvedDayOff: [],
      flightDays: [],
      preferredShifts: new Map([[3, new Set(["T8"])]]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-helio", "uuid-gabriel", "uuid-pref"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 20, pao_espacamento_turnos: 2, pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    expect(tryPlaceT8Block(ws, "uuid-pref", "2026-07-01")).toBe(true);
    expect(tryPlaceT8Block(ws, "uuid-pref", "2026-07-06")).toBe(true);

    expect(ws.hasPaoCoverage("2026-07-09", "T8")).toBe(false);
    expect(tryAssignT8CoverageGap(ws, "2026-07-09")).toBe(true);
    expect(ws.getShiftOnDay(2, "2026-07-09")?.toUpperCase()).toBe("T8");
    expect(ws.getShiftOnDay(1, "2026-07-09")).toBeUndefined();
    expect(ws.getShiftOnDay(2, "2026-07-10")?.toUpperCase()).toBe("T8");
  });

  it("cobertura T6: furo de cota aloca mais novo entre quem não prefere o turno", () => {
    const senior = emp(1, "Senior", "PAO", 1);
    const junior = emp(2, "Junior", "PAO", 50);
    senior.uuid = "uuid-senior";
    junior.uuid = "uuid-junior";

    const input: GenerationInput = {
      year: 2026,
      month: 7,
      employees: [senior, junior],
      shifts: baseShifts(),
      lockedAllocations: [],
      vacationDays: [],
      approvedDayOff: [],
      flightDays: [],
      preferredShifts: new Map([
        [1, new Set(["T7"])],
        [2, new Set(["T7"])],
      ]),
    };
    const options = {
      motorVersion: MOTOR_VERSION_NEXT,
      allowedShiftCodes: ["T6", "T7", "T8"],
      coverageShiftCodes: ["T6"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        coverage_t6: true,
      },
      motorParams: {
        [paoShiftParamId("meta_turnos", "T6")]: 20,
        [paoShiftParamId("meta_turnos", "T7")]: 20,
      },
    };
    const ws = new CleanWorkspace(input, options);
    ws.fillCoverageGaps();
    expect(ws.getShiftOnDay(junior.domainId, "2026-07-01")?.toUpperCase()).toBe("T6");
    expect(ws.getShiftOnDay(senior.domainId, "2026-07-01")).toBeUndefined();
  });

  it("cobertura T8 fim de mês: dia 31 + pré-alocações agosto T8/ND CONTINUIDADE", () => {
    const ana = emp(1, "Ana", "PAO", 1);
    const bruno = emp(2, "Bruno", "PAO", 2);
    ana.uuid = "uuid-a";
    bruno.uuid = "uuid-b";

    const input: GenerationInput = {
      year: 2026,
      month: 7,
      employees: [ana, bruno],
      shifts: baseShifts(),
      lockedAllocations: [
        { employeeUuid: "uuid-b", date: "2026-07-31", label: "SIMULADOR" },
      ],
      vacationDays: [],
      approvedDayOff: [],
      flightDays: [],
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-a", "uuid-b"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
        t8_t8_nd: true,
        locked_preallocations: true,
        coverage_t8: true,
      },
      motorParams: { pao_meta_turnos: 20, pao_espacamento_turnos: 2, pao_max_consecutivos: 6 },
    };

    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    expect(ws.tryAssign("uuid-b", "2026-07-30", "T8", "TEST")).toBe(true);

    expect(ws.hasPaoCoverage("2026-07-31", "T8")).toBe(false);
    expect(tryAssignT8CoverageGap(ws, "2026-07-31")).toBe(true);
    expect(ws.hasPaoCoverage("2026-07-31", "T8")).toBe(true);
    expect(ws.getShiftOnDay(1, "2026-07-31")?.toUpperCase()).toBe("T8");

    const crossMonth = ws.crossMonthPreAllocations;
    expect(crossMonth.some((r) => r.employeeUuid === "uuid-a" && r.date === "2026-08-01" && r.label.toUpperCase() === "T8")).toBe(
      true,
    );
    expect(
      crossMonth.some(
        (r) =>
          r.employeeUuid === "uuid-a" &&
          r.date === "2026-08-02" &&
          r.label.toUpperCase() === CROSS_MONTH_ND_LABEL.toUpperCase(),
      ),
    ).toBe(true);

    const result = generateCleanSchedule(input, options);
    expect(result.crossMonthPreAllocations?.length).toBeGreaterThan(0);
    expect(
      result.crossMonthPreAllocations?.some(
        (r) => r.date === "2026-08-01" && r.label.toUpperCase() === "T8",
      ),
    ).toBe(true);
    expect(
      result.crossMonthPreAllocations?.some(
        (r) =>
          r.date === "2026-08-02" &&
          r.label.toUpperCase() === CROSS_MONTH_ND_LABEL.toUpperCase(),
      ),
    ).toBe(true);
  });

  it("finalizeCrossMonth: T8 dia 31 gera T8 01/8 e ND CONTINUIDADE 02/8 no resultado", () => {
    const ana = emp(1, "Ana", "PAO", 1);
    ana.uuid = "uuid-a";
    const input: GenerationInput = {
      year: 2026,
      month: 7,
      employees: [ana],
      shifts: baseShifts(),
      lockedAllocations: [],
      vacationDays: [],
      approvedDayOff: [],
      flightDays: [],
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    };
    const options = {
      scopeEmployeeUuids: ["uuid-a"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T8"],
      enabledRules: {
        preferred_shifts: true,
        t8_t8_nd: true,
        coverage_t8: true,
        max_6_consecutive: true,
      },
      motorParams: { pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    expect(ws.tryAssign("uuid-a", "2026-07-31", "T8", "TEST")).toBe(true);
    finalizeCrossMonthContinuations(ws);
    expect(
      ws.crossMonthPreAllocations.some(
        (r) => r.employeeUuid === "uuid-a" && r.date === "2026-08-01" && r.label === "T8",
      ),
    ).toBe(true);
    expect(
      ws.crossMonthPreAllocations.some(
        (r) =>
          r.employeeUuid === "uuid-a" &&
          r.date === "2026-08-02" &&
          r.label === CROSS_MONTH_ND_LABEL,
      ),
    ).toBe(true);
  });

  it("6x1 cross-month: 6 dias em junho pré-aloca FOLGA em 01/7", () => {
    const ana = emp(1, "Ana", "PAO", 1);
    ana.uuid = "uuid-a";
    const input: GenerationInput = {
      year: 2026,
      month: 6,
      employees: [ana],
      shifts: baseShifts(),
      lockedAllocations: [],
      vacationDays: [],
      approvedDayOff: [],
      flightDays: [],
      crossMonthHistory: {
        assignments: [
          { employeeUuid: "uuid-a", date: "2026-06-25", shiftCode: "T6" },
          { employeeUuid: "uuid-a", date: "2026-06-26", shiftCode: "T6" },
          { employeeUuid: "uuid-a", date: "2026-06-27", shiftCode: "T6" },
          { employeeUuid: "uuid-a", date: "2026-06-28", shiftCode: "T6" },
          { employeeUuid: "uuid-a", date: "2026-06-29", shiftCode: "T6" },
          { employeeUuid: "uuid-a", date: "2026-06-30", shiftCode: "T6" },
        ],
        allocations: [],
      },
    };
    const options = {
      scopeEmployeeUuids: ["uuid-a"],
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6", "T7", "T8"],
      enabledRules: { max_6_consecutive: true },
      motorParams: { pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    ws.applyLockedPreAllocations();
    finalizeCrossMonthContinuations(ws);
    expect(
      ws.crossMonthPreAllocations.some(
        (r) => r.employeeUuid === "uuid-a" && r.date === "2026-07-01" && r.label === "FOLGA",
      ),
    ).toBe(true);
  });
});
