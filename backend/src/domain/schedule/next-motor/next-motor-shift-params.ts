import { RATEIO_TURN_CODES } from "../clean-engine/clean-types.js";

export type PaoShiftParamKind =
  | "meta_turnos"
  | "espacamento"
  | "meta_dias_trabalhados"
  | "meta_folgas"
  | "meta_folga_social"
  | "max_consecutivos";

const PAO_SHIFT_PARAM_PREFIX = "pao_shift_";

const RATEIO_ORDER = new Map<string, number>(RATEIO_TURN_CODES.map((code, index) => [code, index]));

export const PAO_SHIFT_PARAM_DEFS: Record<
  PaoShiftParamKind,
  {
    label: string;
    description: (shiftCode: string) => string;
    ruleId: string;
    defaultValue: number;
    min: number;
    max: number;
    locked?: boolean;
    legacyGlobalId?: string;
  }
> = {
  meta_turnos: {
    label: "Meta de turnos",
    description: (code) => `Quantidade de turnos ${code} alocados por PAO no mês.`,
    ruleId: "pao_meta_turnos",
    defaultValue: 20,
    min: 0,
    max: 31,
    legacyGlobalId: "pao_meta_turnos",
  },
  espacamento: {
    label: "Espaçamento entre turnos",
    description: (code) =>
      code === "T8"
        ? "Dias em branco entre blocos T8/T8/ND. Conta só dias livres; ND e dias ocupados não entram na conta."
        : `Dias em branco entre turnos ${code}. Conta só dias livres; ND e dias ocupados não entram na conta.`,
    ruleId: "pao_espacamento_turnos",
    defaultValue: 0,
    min: 0,
    max: 15,
    legacyGlobalId: "pao_espacamento_turnos",
  },
  meta_dias_trabalhados: {
    label: "Meta de dias trabalhados",
    description: (code) =>
      `Dias produtivos por PAO em ${code} (turnos + ND + voo + simulador + curso + CMA + outros).`,
    ruleId: "pao_meta_dias_trabalhados",
    defaultValue: 20,
    min: 0,
    max: 31,
    legacyGlobalId: "pao_meta_dias_trabalhados",
  },
  meta_folgas: {
    label: "Meta de folgas",
    description: (code) => `Folgas comuns e sociais por PAO relacionadas ao turno ${code}.`,
    ruleId: "pao_10_folgas",
    defaultValue: 10,
    min: 0,
    max: 31,
    legacyGlobalId: "pao_meta_folgas",
  },
  meta_folga_social: {
    label: "Folgas sociais",
    description: (code) => `Folgas sociais (fim de semana) por PAO para ${code}.`,
    ruleId: "pao_1_folga_social",
    defaultValue: 1,
    min: 0,
    max: 4,
    legacyGlobalId: "pao_meta_folga_social",
  },
  max_consecutivos: {
    label: "Máx. dias consecutivos",
    description: (code) => `Limite de dias trabalhados seguidos em alocações ${code}.`,
    ruleId: "max_6_consecutive",
    defaultValue: 6,
    min: 1,
    max: 15,
    legacyGlobalId: "pao_max_consecutivos",
  },
};

export const PAO_SHIFT_PARAM_KINDS = Object.keys(PAO_SHIFT_PARAM_DEFS) as PaoShiftParamKind[];

/** Regras PAO configuráveis por turno (toggle na UI de cada turno). */
export const PAO_SHIFT_RULE_IDS = [
  "pao_meta_turnos",
  "pao_espacamento_turnos",
  "pao_meta_dias_trabalhados",
  "pao_10_folgas",
  "pao_1_folga_social",
] as const;

export function isRateioShiftCode(code: string): boolean {
  return RATEIO_ORDER.has(code.toUpperCase());
}

export function paoShiftParamId(kind: PaoShiftParamKind, shiftCode: string): string {
  return `${PAO_SHIFT_PARAM_PREFIX}${kind}__${shiftCode.toUpperCase()}`;
}

export function paoShiftRuleEnabledId(ruleId: string, shiftCode: string): string {
  return `pao_shift_rule__${ruleId}__${shiftCode.toUpperCase()}`;
}

export function isPaoShiftRuleEnabledId(id: string): boolean {
  return id.startsWith("pao_shift_rule__");
}

export function parsePaoShiftRuleEnabledId(
  id: string,
): { ruleId: string; shiftCode: string } | null {
  if (!id.startsWith("pao_shift_rule__")) return null;
  const rest = id.slice("pao_shift_rule__".length);
  const sep = rest.lastIndexOf("__");
  if (sep <= 0) return null;
  const ruleId = rest.slice(0, sep);
  const shiftCode = rest.slice(sep + 2);
  if (!isRateioShiftCode(shiftCode)) return null;
  return { ruleId, shiftCode };
}

/** @deprecated use paoShiftParamId('meta_turnos', code) */
export function paoShiftMetaTurnosId(shiftCode: string): string {
  return paoShiftParamId("meta_turnos", shiftCode);
}

/** @deprecated use paoShiftParamId('espacamento', code) */
export function paoShiftEspacamentoId(shiftCode: string): string {
  return paoShiftParamId("espacamento", shiftCode);
}

export function parsePaoShiftParamId(id: string): { kind: PaoShiftParamKind; shiftCode: string } | null {
  if (!id.startsWith(PAO_SHIFT_PARAM_PREFIX)) return null;
  const rest = id.slice(PAO_SHIFT_PARAM_PREFIX.length);
  const sep = rest.lastIndexOf("__");
  if (sep <= 0) return null;
  const kind = rest.slice(0, sep) as PaoShiftParamKind;
  const shiftCode = rest.slice(sep + 2);
  if (!PAO_SHIFT_PARAM_KINDS.includes(kind) || !isRateioShiftCode(shiftCode)) return null;
  return { kind, shiftCode };
}

export function isPaoShiftParamId(id: string): boolean {
  return parsePaoShiftParamId(id) != null;
}

export function shiftCodeFromPaoShiftParamId(id: string): string | null {
  return parsePaoShiftParamId(id)?.shiftCode ?? null;
}

export function defaultPaoRateioShiftCodes(): string[] {
  return [...RATEIO_TURN_CODES];
}

export function listPaoRateioShiftCodesFromShifts(
  shifts: Array<{ code: string; active: boolean }>,
): string[] {
  const codes = shifts
    .filter((s) => s.active && isRateioShiftCode(s.code))
    .map((s) => s.code.toUpperCase());
  return [...new Set(codes)].sort(
    (a, b) => (RATEIO_ORDER.get(a) ?? 99) - (RATEIO_ORDER.get(b) ?? 99),
  );
}

function clampShiftParam(
  raw: number | undefined,
  bounds: { defaultValue: number; min: number; max: number },
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return bounds.defaultValue;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(raw)));
}

export function migrateLegacyPaoShiftParams(
  stored: Record<string, number>,
  shiftCodes: string[],
): Record<string, number> {
  const out = { ...stored };
  for (const code of shiftCodes) {
    for (const kind of PAO_SHIFT_PARAM_KINDS) {
      const id = paoShiftParamId(kind, code);
      if (out[id] !== undefined) continue;
      const def = PAO_SHIFT_PARAM_DEFS[kind];
      if (def.legacyGlobalId && stored[def.legacyGlobalId] !== undefined) {
        out[id] = stored[def.legacyGlobalId];
      }
    }
  }
  return out;
}

export function mergePaoShiftParams(
  stored: Record<string, number> | null | undefined,
  shiftCodes: string[],
): Record<string, number> {
  const codes = shiftCodes.length ? shiftCodes : defaultPaoRateioShiftCodes();
  const migrated = migrateLegacyPaoShiftParams(stored ?? {}, codes);
  const out: Record<string, number> = {};
  for (const code of codes) {
    for (const kind of PAO_SHIFT_PARAM_KINDS) {
      const def = PAO_SHIFT_PARAM_DEFS[kind];
      out[paoShiftParamId(kind, code)] = clampShiftParam(
        migrated[paoShiftParamId(kind, code)],
        def,
      );
    }
  }
  return out;
}

export function sanitizePaoShiftParamsPatch(
  patch: Record<string, number>,
  shiftCodes: string[],
): Record<string, number> {
  const allowedCodes = new Set(shiftCodes.map((c) => c.toUpperCase()));
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(patch)) {
    const parsed = parsePaoShiftParamId(id);
    if (!parsed || !allowedCodes.has(parsed.shiftCode)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[id] = clampShiftParam(raw, PAO_SHIFT_PARAM_DEFS[parsed.kind]);
  }
  return out;
}

export function motorShiftParamValue(
  params: Record<string, number> | null | undefined,
  shiftCode: string,
  kind: PaoShiftParamKind,
): number {
  const def = PAO_SHIFT_PARAM_DEFS[kind];
  const id = paoShiftParamId(kind, shiftCode);
  const raw = params?.[id];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (def.legacyGlobalId) {
    const legacy = params?.[def.legacyGlobalId];
    if (typeof legacy === "number" && Number.isFinite(legacy)) return Math.round(legacy);
  }
  return def.defaultValue;
}

export interface PaoShiftParamFieldView {
  id: string;
  kind: PaoShiftParamKind;
  label: string;
  description: string;
  ruleId: string;
  value: number;
  min: number;
  max: number;
  locked: boolean;
}

export interface PaoShiftRuleFieldView {
  id: string;
  globalRuleId: string;
  label: string;
  description: string;
  enabled: boolean;
  locked: boolean;
}

export interface PaoShiftParamsView {
  shiftCode: string;
  shiftName: string;
  fields: PaoShiftParamFieldView[];
  rules: PaoShiftRuleFieldView[];
}

function buildShiftRuleViews(
  shiftCode: string,
  enabledMap: Record<string, boolean>,
  rulesCatalog: Array<{ id: string; label: string; description: string; locked: boolean; defaultEnabled: boolean }>,
): PaoShiftRuleFieldView[] {
  const out: PaoShiftRuleFieldView[] = [];
  for (const ruleId of PAO_SHIFT_RULE_IDS) {
    const def = rulesCatalog.find((r) => r.id === ruleId);
    if (!def) continue;
    const perShiftId = paoShiftRuleEnabledId(ruleId, shiftCode);
    const enabled =
      typeof enabledMap[perShiftId] === "boolean"
        ? enabledMap[perShiftId]
        : (enabledMap[def.id] ?? def.defaultEnabled);
    out.push({
      id: perShiftId,
      globalRuleId: def.id,
      label: def.label.replace(/^PAO — /, ""),
      description: `Aplica ao turno ${shiftCode}: ${def.description}`,
      enabled: def.locked ? true : enabled,
      locked: def.locked,
    });
  }
  if (shiftCode === "T8") {
    const t8 = rulesCatalog.find((r) => r.id === "t8_t8_nd");
    if (t8) {
      out.push({
        id: t8.id,
        globalRuleId: t8.id,
        label: t8.label,
        description: t8.description,
        enabled: enabledMap[t8.id] ?? t8.defaultEnabled,
        locked: t8.locked,
      });
    }
  }
  return out;
}

export function buildPaoShiftParamsView(
  paramsMap: Record<string, number>,
  shifts: Array<{ code: string; name: string; active: boolean }>,
  enabledMap: Record<string, boolean> = {},
  rulesCatalog: Array<{ id: string; label: string; description: string; locked: boolean; defaultEnabled: boolean }> = [],
): PaoShiftParamsView[] {
  const shiftCodes = listPaoRateioShiftCodesFromShifts(shifts);
  const nameByCode = new Map(shifts.map((s) => [s.code.toUpperCase(), s.name]));
  return shiftCodes.map((code) => ({
    shiftCode: code,
    shiftName: nameByCode.get(code) ?? code,
    fields: PAO_SHIFT_PARAM_KINDS.map((kind) => {
      const def = PAO_SHIFT_PARAM_DEFS[kind];
      const id = paoShiftParamId(kind, code);
      return {
        id,
        kind,
        label: def.label,
        description: def.description(code),
        ruleId: def.ruleId,
        value: paramsMap[id] ?? def.defaultValue,
        min: def.min,
        max: def.max,
        locked: Boolean(def.locked),
      };
    }),
    rules: buildShiftRuleViews(code, enabledMap, rulesCatalog),
  }));
}
