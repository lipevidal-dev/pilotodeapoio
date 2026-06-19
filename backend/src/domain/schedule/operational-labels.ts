import { PROTECTED_PREALLOC_TYPES, VACATION_TYPES } from "../rules/constants.js";

/** Labels removidos na regeneração — só o que o motor regrava; cadastros manuais permanecem. */
export const REGENERATION_CLEAR_LABELS = [
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
  "ND",
  "VOO",
] as const;

/**
 * Labels removidos pelo endpoint de limpar geração (turnos T6/T7/T8/T9 via assignments).
 * @see clear-generated-policy.ts — FP, FANI, férias e cadastros manuais são preservados.
 */
export const CLEAR_GENERATED_LABELS = [
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
  "ND",
  "VOO",
] as const;

/** ND fixo após bloco T8/T8 que cruza o fim do mês — preservado na regeneração. */
export const CROSS_MONTH_ND_LABEL = "ND CONTINUIDADE";

/** Labels de pré-alocação manual — preservados ao limpar/regenerar escala. */
export const MANUAL_PREALLOC_LABELS = new Set([
  "SIMULADOR",
  "CURSO",
  "CURSO ONLINE",
  "CMA",
  "OUTRO",
  "FOLGA PEDIDA",
  "FP",
  "FÉRIAS",
  "FERIAS",
  "FOLGA ANIVERSÁRIO",
  "FANI",
  "FOLGA ESCOLHIDA",
  CROSS_MONTH_ND_LABEL,
]);

export function normalizeOperationalLabel(label: string): string {
  const trimmed = label.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "FERIAS" || upper === "FER" || upper === "FÉRIA" || upper === "FERIA") {
    return "FÉRIAS";
  }
  if (upper === "FP" || upper.includes("FOLGA PEDIDA")) {
    return "FOLGA PEDIDA";
  }
  if (upper === "FANI" || upper.includes("FOLGA ANIVERS")) {
    return "FOLGA ANIVERSÁRIO";
  }
  if (upper === "CURSO") {
    return "CURSO ONLINE";
  }
  if (upper === "ND CONTINUIDADE") {
    return CROSS_MONTH_ND_LABEL;
  }
  return trimmed;
}

export function isOperationalHardBlock(label: string): boolean {
  const n = normalizeOperationalLabel(label).toUpperCase();
  if (VACATION_TYPES.has(n) || n === "FÉRIAS") return true;
  if (
    n === "FOLGA PEDIDA" ||
    n === "VOO" ||
    n === "FOLGA ANIVERSÁRIO" ||
    n === "FANI" ||
    n === "ND" ||
    n === CROSS_MONTH_ND_LABEL.toUpperCase() ||
    n === "FOLGA" ||
    n === "FOLGA SOCIAL" ||
    n === "FOLGA AGRUPADA"
  ) {
    return true;
  }
  return PROTECTED_PREALLOC_TYPES.has(n);
}
