import { normalizeOperationalLabel } from "./operational-labels.js";

/**
 * Pré-alocações criadas pelo motor — removíveis em "Limpar escala".
 * Não inclui cadastros operacionais manuais (FP, férias, simulador, etc.).
 */
export const MOTOR_GENERATED_PREALLOC_LABELS = [
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
  "ND",
  "VOO",
] as const;

/** Cadastros manuais / operacionais — nunca apagar ao limpar escala. */
export const MANUAL_OPERATIONAL_PRESERVE_LABELS = [
  "FOLGA PEDIDA",
  "FP",
  "FÉRIAS",
  "FERIAS",
  "FOLGA ANIVERSÁRIO",
  "FANI",
  "FOLGA ESCOLHIDA",
  "SIMULADOR",
  "CURSO",
  "CURSO ONLINE",
  "CMA",
  "OUTRO",
] as const;

const preserveSet = new Set(
  MANUAL_OPERATIONAL_PRESERVE_LABELS.map((l) => normalizeOperationalLabel(l).toUpperCase()),
);

const motorGeneratedSet = new Set(
  MOTOR_GENERATED_PREALLOC_LABELS.map((l) => normalizeOperationalLabel(l).toUpperCase()),
);

/** Indica se uma preAllocation deve ser apagada ao limpar a geração. */
export function isPreAllocationRemovedOnClear(label: string): boolean {
  const normalized = normalizeOperationalLabel(label).toUpperCase();
  if (preserveSet.has(normalized)) return false;
  return motorGeneratedSet.has(normalized);
}

/** Labels Prisma `in` — apenas o que o motor pode ter gravado (interseção segura). */
export function listClearablePreAllocationLabels(): string[] {
  return [...MOTOR_GENERATED_PREALLOC_LABELS];
}
