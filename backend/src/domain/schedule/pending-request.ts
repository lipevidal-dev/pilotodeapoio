/** Marca pré-alocações criadas pelo portal aguardando aprovação do admin. */
export const PENDING_PREALLOC_NOTES = "__PENDING__";

/** Marca pré-alocações APAO aprovadas pelo admin após solicitação no portal. */
export const PORTAL_APPROVED_PREALLOC_NOTES = "__PORTAL_APPROVED__";

export function isPendingPreAllocationNotes(notes: string | null | undefined): boolean {
  return (notes ?? "").startsWith(PENDING_PREALLOC_NOTES);
}

export function isPortalApprovedPreAllocationNotes(notes: string | null | undefined): boolean {
  return (notes ?? "").startsWith(PORTAL_APPROVED_PREALLOC_NOTES);
}

export function stripPendingPreAllocationNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.replace(PENDING_PREALLOC_NOTES, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function stripPortalApprovedPreAllocationNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.replace(PORTAL_APPROVED_PREALLOC_NOTES, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildPortalApprovedPreAllocationNotes(priorNotes: string | null | undefined): string {
  const userNotes = stripPendingPreAllocationNotes(priorNotes);
  if (userNotes) return `${PORTAL_APPROVED_PREALLOC_NOTES} ${userNotes}`;
  return PORTAL_APPROVED_PREALLOC_NOTES;
}

/** Marca folgas pedidas criadas pelo portal do colaborador. */
export const PORTAL_FP_NOTES = "__PORTAL_FP__";

export function buildPortalFpNotes(userNotes?: string | null): string {
  const trimmed = userNotes?.trim();
  if (trimmed) return `${PORTAL_FP_NOTES} ${trimmed}`;
  return PORTAL_FP_NOTES;
}

export function isPortalFpRequestNotes(
  notes: string | null | undefined,
  status: "PENDING" | "APPROVED" | "REJECTED",
): boolean {
  if ((notes ?? "").startsWith(PORTAL_FP_NOTES)) return true;
  // Pendentes sem prefixo (legado) contam como solicitação do colaborador.
  return status === "PENDING";
}

export function stripPortalFpNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.replace(PORTAL_FP_NOTES, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
