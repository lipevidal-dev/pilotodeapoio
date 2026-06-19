import { describe, expect, it } from "vitest";
import {
  buildNextMotorRulesView,
  mergeNextMotorEnabled,
  sanitizeNextMotorPatch,
} from "../domain/schedule/next-motor/next-motor-rules-catalog.js";
import {
  mergeNextMotorParams,
  sanitizeNextMotorParamsPatch,
} from "../domain/schedule/next-motor/next-motor-config-values.js";
import {
  mergePaoShiftParams,
  paoShiftParamId,
} from "../domain/schedule/next-motor/next-motor-shift-params.js";
import { parseNextMotorStored } from "../domain/schedule/next-motor/next-motor-stored-config.js";
import { sanitizeAllowedShiftCodes } from "../domain/schedule/next-motor/next-motor-allowed-shifts.js";

describe("next-motor-rules-catalog", () => {
  it("regras locked permanecem ativas mesmo desmarcadas", () => {
    const merged = mergeNextMotorEnabled({
      min_12h_rest: false,
      t8_t8_nd: false,
      coverage_t6: false,
    });
    expect(merged.min_12h_rest).toBe(true);
    expect(merged.t8_t8_nd).toBe(true);
    expect(merged.coverage_t6).toBe(false);
  });

  it("sanitize ignora ids desconhecidos e regras locked", () => {
    expect(sanitizeNextMotorPatch({ min_12h_rest: false, foo: true })).toEqual({});
    expect(sanitizeNextMotorPatch({ coverage_t6: false })).toEqual({ coverage_t6: false });
  });

  it("catalogo expõe metas PAO separadas e cobertura T9", () => {
    const view = buildNextMotorRulesView(mergeNextMotorEnabled({}));
    expect(view.some((r) => r.id === "pao_meta_turnos")).toBe(true);
    expect(view.some((r) => r.id === "pao_meta_dias_trabalhados")).toBe(true);
    expect(view.some((r) => r.id === "pao_espacamento_turnos")).toBe(true);
    expect(view.some((r) => r.id === "coverage_t9")).toBe(true);
    expect(view.some((r) => r.id === "parallel_t9")).toBe(false);
  });

  it("migra legado pao_20_turnos e parallel_t9", () => {
    const parsed = parseNextMotorStored({
      enabled: { pao_20_turnos: false, parallel_t9: true },
      params: {},
      scopeEmployeeIds: null,
    });
    expect(parsed.enabled?.pao_meta_turnos).toBe(false);
    expect(parsed.enabled?.pao_meta_dias_trabalhados).toBe(false);
    expect(parsed.enabled?.coverage_t9).toBe(true);
  });

  it("params respeitam min/max", () => {
    const merged = mergeNextMotorParams({ apao_folgas_ciclo: -3 }, ["T8"]);
    expect(merged[paoShiftParamId("meta_turnos", "T8")]).toBe(20);
    expect(merged.apao_folgas_ciclo).toBe(1);
    expect(sanitizeNextMotorParamsPatch({ [paoShiftParamId("meta_turnos", "T8")]: 18 }, ["T8"])).toEqual({
      [paoShiftParamId("meta_turnos", "T8")]: 18,
    });
  });

  it("migra meta legada para cada turno rateio", () => {
    const merged = mergePaoShiftParams({ pao_meta_turnos: 12, pao_espacamento_turnos: 3 }, [
      "T6",
      "T8",
    ]);
    expect(merged[paoShiftParamId("meta_turnos", "T6")]).toBe(12);
    expect(merged[paoShiftParamId("meta_turnos", "T8")]).toBe(12);
  });

  it("parseNextMotorStored preserva allowedShiftCodes até sanitizar com turnos ativos", () => {
    const parsed = parseNextMotorStored({
      enabled: {},
      params: {},
      scopeEmployeeIds: null,
      allowedShiftCodes: ["T8"],
    });
    expect(parsed.allowedShiftCodes).toEqual(["T8"]);
    expect(sanitizeAllowedShiftCodes(parsed.allowedShiftCodes, ["T6", "T7", "T8", "T9"])).toEqual(["T8"]);
  });
});

describe("next-motor-employee-prefs", () => {
  it("preferências do motor sobrescrevem cadastro do funcionário", async () => {
    const { applyMotorEmployeeShiftPrefs } = await import(
      "../domain/schedule/next-motor/next-motor-employee-prefs.js"
    );
    const shifts = [
      { id: "s-t8", code: "T8", name: "T8", startTime: "22:00", endTime: "06:00", roleType: "PAO", durationHours: 8, active: true, displayOrder: 1, mandatoryCoverage: true, requiresT8PairNd: true, coverageType: "REQUIRED" },
      { id: "s-t6", code: "T6", name: "T6", startTime: "06:00", endTime: "14:00", roleType: "PAO", durationHours: 8, active: true, displayOrder: 2, mandatoryCoverage: true, requiresT8PairNd: false, coverageType: "REQUIRED" },
    ] as import("@prisma/client").Shift[];

    const result = applyMotorEmployeeShiftPrefs({
      preferredShiftRows: [{ employeeUuid: "emp-a", shiftCode: "T6" }],
      shiftRestrictionRows: [{ employeeUuid: "emp-b", shiftCode: "T8" }],
      employeePrefs: {
        "emp-a": { preferredShiftId: "s-t8", restrictedShiftIds: [] },
        "emp-b": { preferredShiftId: null, restrictedShiftIds: ["s-t6"] },
      },
      shifts,
    });

    expect(result.preferredShiftRows).toEqual([{ employeeUuid: "emp-a", shiftCode: "T8" }]);
    expect(result.shiftRestrictionRows).toEqual([{ employeeUuid: "emp-b", shiftCode: "T6" }]);
  });
});
