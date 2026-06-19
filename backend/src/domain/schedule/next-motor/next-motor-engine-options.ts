import type { Shift } from "../../shift/types.js";
import { MOTOR_VERSION_NEXT } from "../engine-metadata.js";
import type { CleanEngineOptions } from "../clean-engine/clean-types.js";
import type { NextMotorStoredConfig } from "./next-motor-stored-config.js";
import { resolveAllowedShiftCodes } from "./next-motor-allowed-shifts.js";

const COVERAGE_RULE_TO_SHIFT: Record<string, string> = {
  coverage_t6: "T6",
  coverage_t7: "T7",
  coverage_t8: "T8",
  coverage_t9: "T9",
};

function activeRateioShiftCodes(shifts: Array<{ code: string; active?: boolean }>): string[] {
  return shifts
    .filter((s) => s.active !== false)
    .map((s) => s.code.toUpperCase())
    .filter((code) => ["T6", "T7", "T8", "T9"].includes(code));
}

function activeShiftCodes(shifts: Array<{ code: string; active?: boolean }>): Set<string> {
  return new Set(shifts.filter((s) => s.active !== false).map((s) => s.code.toUpperCase()));
}

/** Converte config persistida do motor NEXT em opções do CleanEngine. */
export function buildCleanEngineOptionsFromMotorConfig(
  cfg: NextMotorStoredConfig,
  shifts: Array<Pick<Shift, "code" | "active">>,
): CleanEngineOptions {
  const active = activeShiftCodes(shifts);
  const rateioActive = activeRateioShiftCodes(shifts);
  const allowedShiftCodes = resolveAllowedShiftCodes(cfg.allowedShiftCodes, rateioActive);

  const coverageShiftCodes: string[] = [];
  for (const [ruleId, code] of Object.entries(COVERAGE_RULE_TO_SHIFT)) {
    if (!allowedShiftCodes.includes(code)) continue;
    if (cfg.enabled[ruleId] === false) continue;
    if (active.has(code)) coverageShiftCodes.push(code);
  }

  return {
    allowedShiftCodes,
    coverageShiftCodes: coverageShiftCodes.length > 0 ? coverageShiftCodes : undefined,
    scopeEmployeeUuids: cfg.scopeEmployeeIds,
    enabledRules: cfg.enabled,
    motorParams: cfg.params,
    motorVersion: MOTOR_VERSION_NEXT,
  };
}
