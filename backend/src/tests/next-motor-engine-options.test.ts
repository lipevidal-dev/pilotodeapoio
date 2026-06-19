import { describe, expect, it } from "vitest";
import { buildCleanEngineOptionsFromMotorConfig } from "../domain/schedule/next-motor/next-motor-engine-options.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import { mergeNextMotorEnabled } from "../domain/schedule/next-motor/next-motor-rules-catalog.js";
import { mergeNextMotorParams } from "../domain/schedule/next-motor/next-motor-config-values.js";

describe("next-motor-engine-options", () => {
  const shifts = [
    { code: "T6", active: true },
    { code: "T7", active: true },
    { code: "T8", active: true },
    { code: "T9", active: true },
  ];

  it("mapeia cobertura e escopo para CleanEngineOptions", () => {
    const cfg = {
      enabled: mergeNextMotorEnabled({ coverage_t9: false }),
      params: mergeNextMotorParams({}),
      scopeEmployeeIds: ["uuid-a", "uuid-b"],
    };
    const opts = buildCleanEngineOptionsFromMotorConfig(cfg, shifts);
    expect(opts.motorVersion).toBe(MOTOR_VERSION_NEXT);
    expect(opts.allowedShiftCodes).toEqual(["T6", "T7", "T8", "T9"]);
    expect(opts.coverageShiftCodes).toEqual(["T6", "T7", "T8"]);
    expect(opts.scopeEmployeeUuids).toEqual(["uuid-a", "uuid-b"]);
    expect(opts.enabledRules?.coverage_t9).toBe(false);
  });

  it("restringe geração aos turnos permitidos na configuração", () => {
    const cfg = {
      enabled: mergeNextMotorEnabled({}),
      params: mergeNextMotorParams({}),
      scopeEmployeeIds: null,
      allowedShiftCodes: ["T8"],
    };
    const opts = buildCleanEngineOptionsFromMotorConfig(cfg, shifts);
    expect(opts.allowedShiftCodes).toEqual(["T8"]);
    expect(opts.coverageShiftCodes).toEqual(["T8"]);
  });
});
