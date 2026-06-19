import type { CleanEngineOptions } from "./clean-types.js";
import { mergeNextMotorParams } from "../next-motor/next-motor-config-values.js";
import {
  motorShiftParamValue,
  paoShiftRuleEnabledId,
  defaultPaoRateioShiftCodes,
} from "../next-motor/next-motor-shift-params.js";

export function motorRuleEnabled(options: CleanEngineOptions, ruleId: string): boolean {
  if (!options.enabledRules) return true;
  return options.enabledRules[ruleId] !== false;
}

export function motorShiftRuleEnabled(
  options: CleanEngineOptions,
  ruleId: string,
  shiftCode: string,
): boolean {
  const perShiftId = paoShiftRuleEnabledId(ruleId, shiftCode);
  const perShift = options.enabledRules?.[perShiftId];
  if (typeof perShift === "boolean") return perShift;
  return motorRuleEnabled(options, ruleId);
}

export function motorParam(options: CleanEngineOptions, paramId: string, fallback: number): number {
  const raw = options.motorParams?.[paramId];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  return mergeNextMotorParams({})[paramId] ?? fallback;
}

export function motorShiftMetaTurnos(options: CleanEngineOptions, shiftCode: string, fallback = 20): number {
  return motorShiftParamValue(options.motorParams, shiftCode, "meta_turnos") ?? fallback;
}

export function motorShiftEspacamento(options: CleanEngineOptions, shiftCode: string, fallback = 0): number {
  return motorShiftParamValue(options.motorParams, shiftCode, "espacamento") ?? fallback;
}

export function motorShiftMaxConsecutivos(options: CleanEngineOptions, shiftCode: string, fallback = 6): number {
  return motorShiftParamValue(options.motorParams, shiftCode, "max_consecutivos") ?? fallback;
}

/** Soma das metas por turno rateio — teto global de turnos no mês. */
export function sumMotorShiftMetaTurnos(
  options: CleanEngineOptions,
  shiftCodes: string[] = defaultPaoRateioShiftCodes(),
): number {
  if (!motorRuleEnabled(options, "pao_meta_turnos")) return Number.POSITIVE_INFINITY;
  return shiftCodes.reduce((sum, code) => sum + motorShiftMetaTurnos(options, code, 0), 0);
}
