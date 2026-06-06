import { PROTECTED_PREALLOC_TYPES, VACATION_TYPES } from "../rules/constants.js";

/** Labels removidos na regeneração (gerador + cadastros de calendário regravados). */
export const REGENERATION_CLEAR_LABELS = [
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
  "FOLGA ANIVERSÁRIO",
  "ND",
  "FÉRIAS",
  "FERIAS",
  "FOLGA PEDIDA",
  "VOO",
] as const;

/** Labels removidos pelo endpoint de limpar geração (folgas/voos gerados pelo motor). */
export const CLEAR_GENERATED_LABELS = [
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
  "FOLGA ANIVERSÁRIO",
  "ND",
  "VOO",
] as const;

/** Labels de pré-alocação manual válidos — não apagados na regeneração. */
export const MANUAL_PREALLOC_LABELS = new Set([
  "SIMULADOR",
  "CURSO",
  "CURSO ONLINE",
  "CMA",
  "OUTRO",
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
    n === "FOLGA" ||
    n === "FOLGA SOCIAL" ||
    n === "FOLGA AGRUPADA"
  ) {
    return true;
  }
  return PROTECTED_PREALLOC_TYPES.has(n);
}
