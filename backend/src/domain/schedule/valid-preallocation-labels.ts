import { normalizeOperationalLabel } from "./operational-labels.js";

/** Únicos labels permitidos em preAllocations (cadastro manual). */
export const VALID_PREALLOCATION_LABELS = ["SIMULADOR", "CURSO", "CMA", "OUTRO"] as const;

export type ValidPreAllocationLabel = (typeof VALID_PREALLOCATION_LABELS)[number];

/** Labels que devem usar menus específicos — bloqueados em preAllocations. */
export const INVALID_PREALLOCATION_LABELS = [
  "VOO",
  "FÉRIAS",
  "FERIAS",
  "FP",
  "FOLGA PEDIDA",
  "F",
  "FS",
  "FA",
  "FANI",
  "FOLGA ANIVERSÁRIO",
  "ND",
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
] as const;

const VALID_SET = new Set<string>(VALID_PREALLOCATION_LABELS);

export class InvalidPreAllocationLabelError extends Error {
  readonly code = "INVALID_PREALLOCATION_LABEL" as const;

  constructor() {
    super(
      "Este tipo de cadastro operacional deve ser feito no menu específico, não em Pré-alocações.",
    );
    this.name = "InvalidPreAllocationLabelError";
  }
}

export function normalizePreAllocationLabel(label: string): string {
  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (upper === "CURSO ONLINE") return "CURSO";
  return upper;
}

export function assertValidPreAllocationLabel(label: string): ValidPreAllocationLabel {
  const normalized = normalizePreAllocationLabel(label);
  if (!VALID_SET.has(normalized)) {
    throw new InvalidPreAllocationLabelError();
  }
  return normalized as ValidPreAllocationLabel;
}

export function isInvalidPreAllocationLabel(label: string): boolean {
  try {
    assertValidPreAllocationLabel(label);
    return false;
  } catch {
    return true;
  }
}
