import { normalizeOperationalLabel } from "./operational-labels.js";
import {
  isPendingPreAllocationNotes,
  isPortalApprovedPreAllocationNotes,
  PENDING_PREALLOC_NOTES,
  PORTAL_APPROVED_PREALLOC_NOTES,
} from "./pending-request.js";

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

const CROSS_MONTH_NOTES_PREFIX = "cross-month:";

const preserveSet = new Set(
  MANUAL_OPERATIONAL_PRESERVE_LABELS.map((l) => normalizeOperationalLabel(l).toUpperCase()),
);

const motorGeneratedSet = new Set(
  MOTOR_GENERATED_PREALLOC_LABELS.map((l) => normalizeOperationalLabel(l).toUpperCase()),
);

/** Pré-alocação solicitada/aprovada pelo portal — nunca apagar ao limpar escala. */
export function isPortalCadastroPreAllocationNotes(notes: string | null | undefined): boolean {
  return isPendingPreAllocationNotes(notes) || isPortalApprovedPreAllocationNotes(notes);
}

function isCrossMonthContinuationNotes(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith(CROSS_MONTH_NOTES_PREFIX);
}

/** Indica se uma preAllocation deve ser apagada ao limpar a geração. */
export function isPreAllocationRemovedOnClear(label: string, notes?: string | null): boolean {
  if (isPortalCadastroPreAllocationNotes(notes)) return false;
  if (isCrossMonthContinuationNotes(notes)) return false;
  const normalized = normalizeOperationalLabel(label).toUpperCase();
  if (preserveSet.has(normalized)) return false;
  return motorGeneratedSet.has(normalized);
}

/**
 * Filtro Prisma para apagar pré-alocações do motor.
 *
 * Importante: não usar `NOT: { OR: [notes startsWith …] }` sozinho —
 * em SQL, `notes IS NULL` faz o NOT avaliar UNKNOWN e a linha NÃO é apagada
 * (ND/FOLGA/VOO gerados ficavam órfãos ao limpar).
 */
export function clearablePreAllocationWhere(
  scheduleMonthId: string,
  labels: string[] = listClearablePreAllocationLabels(),
) {
  return {
    scheduleMonthId,
    label: { in: labels },
    OR: [
      { notes: null },
      {
        AND: [
          { NOT: { notes: { startsWith: PENDING_PREALLOC_NOTES } } },
          { NOT: { notes: { startsWith: PORTAL_APPROVED_PREALLOC_NOTES } } },
          { NOT: { notes: { startsWith: CROSS_MONTH_NOTES_PREFIX } } },
        ],
      },
    ],
  };
}

/** @deprecated Preferir clearablePreAllocationWhere — o NOT sozinho falha com notes null. */
export function clearablePreAllocationNotesExclusion() {
  return {
    OR: [
      { notes: { startsWith: PENDING_PREALLOC_NOTES } },
      { notes: { startsWith: PORTAL_APPROVED_PREALLOC_NOTES } },
      { notes: { startsWith: CROSS_MONTH_NOTES_PREFIX } },
    ],
  };
}

/** Labels Prisma `in` — apenas o que o motor pode ter gravado (interseção segura). */
export function listClearablePreAllocationLabels(): string[] {
  return [...MOTOR_GENERATED_PREALLOC_LABELS];
}
