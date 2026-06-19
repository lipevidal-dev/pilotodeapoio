import type { NextMotorRuleCategory } from "./next-motor-rules-catalog.js";
import {
  mergePaoShiftParams,
  sanitizePaoShiftParamsPatch,
  defaultPaoRateioShiftCodes,
} from "./next-motor-shift-params.js";

export interface NextMotorNumericParamDefinition {
  id: string;
  label: string;
  description: string;
  category: NextMotorRuleCategory;
  /** Regra associada — valor só se aplica quando a regra estiver ativa. */
  ruleId: string;
  defaultValue: number;
  min: number;
  max: number;
  /** Parâmetro de regra inviolável — valor editável, regra não desliga. */
  locked?: boolean;
}

/** Metas numéricas configuráveis por função/regra (dias, turnos, folgas). */
export const NEXT_MOTOR_NUMERIC_PARAMS: readonly NextMotorNumericParamDefinition[] = [
  {
    id: "apao_dias_trabalhados_ciclo",
    label: "Dias trabalhados (ciclo 6x1)",
    description: "Dias de trabalho por ciclo do APAO.",
    category: "apao",
    ruleId: "apao_regime_6x1",
    defaultValue: 6,
    min: 1,
    max: 15,
  },
  {
    id: "apao_folgas_ciclo",
    label: "Folgas (ciclo 6x1)",
    description: "Folgas por ciclo do APAO.",
    category: "apao",
    ruleId: "apao_regime_6x1",
    defaultValue: 1,
    min: 1,
    max: 15,
  },
] as const;

export type NextMotorNumericParamId = (typeof NEXT_MOTOR_NUMERIC_PARAMS)[number]["id"];

const paramById = new Map(NEXT_MOTOR_NUMERIC_PARAMS.map((p) => [p.id, p]));

export function defaultNextMotorParamsMap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of NEXT_MOTOR_NUMERIC_PARAMS) out[p.id] = p.defaultValue;
  return out;
}

export function mergeNextMotorParams(
  stored: Record<string, number> | null | undefined,
  shiftCodes: string[] = defaultPaoRateioShiftCodes(),
): Record<string, number> {
  const merged = defaultNextMotorParamsMap();
  if (stored) {
    for (const p of NEXT_MOTOR_NUMERIC_PARAMS) {
      const raw = stored[p.id];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        merged[p.id] = Math.min(p.max, Math.max(p.min, Math.round(raw)));
      }
    }
  }
  return { ...merged, ...mergePaoShiftParams(stored, shiftCodes) };
}

export function sanitizeNextMotorParamsPatch(
  patch: Record<string, number>,
  shiftCodes: string[] = defaultPaoRateioShiftCodes(),
): Record<string, number> {
  const staticOut: Record<string, number> = {};
  for (const [id, raw] of Object.entries(patch)) {
    const def = paramById.get(id);
    if (!def || typeof raw !== "number" || !Number.isFinite(raw)) continue;
    staticOut[id] = Math.min(def.max, Math.max(def.min, Math.round(raw)));
  }
  return { ...staticOut, ...sanitizePaoShiftParamsPatch(patch, shiftCodes) };
}

export interface NextMotorNumericParamView {
  id: string;
  label: string;
  description: string;
  category: NextMotorRuleCategory;
  ruleId: string;
  value: number;
  min: number;
  max: number;
  locked: boolean;
}

export function buildNextMotorParamsView(
  paramsMap: Record<string, number>,
): NextMotorNumericParamView[] {
  return NEXT_MOTOR_NUMERIC_PARAMS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    category: p.category,
    ruleId: p.ruleId,
    value: paramsMap[p.id] ?? p.defaultValue,
    min: p.min,
    max: p.max,
    locked: Boolean(p.locked),
  }));
}
