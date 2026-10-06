/** Marker em notes de trocas/pré-alocações criadas por edição admin na escala realizada. */
export const ADMIN_EXECUTED_AUDIT_NOTES = "__ADMIN_EXECUTED_AUDIT__";

export const ADMIN_EXECUTED_AUDIT_LABEL = "Alteração admin na escala realizada";

export function buildAdminExecutedAuditNotes(extra?: string | null): string {
  const trimmed = (extra ?? "").trim();
  if (!trimmed || trimmed.startsWith(ADMIN_EXECUTED_AUDIT_NOTES)) {
    return trimmed || `${ADMIN_EXECUTED_AUDIT_NOTES} ${ADMIN_EXECUTED_AUDIT_LABEL}`;
  }
  return `${ADMIN_EXECUTED_AUDIT_NOTES} ${trimmed}`;
}

export function isAdminExecutedAuditNotes(notes: string | null | undefined): boolean {
  return (notes ?? "").includes(ADMIN_EXECUTED_AUDIT_NOTES);
}

export function displayTokenFromManualType(type: string | null | undefined): string {
  const raw = (type ?? "").trim().toUpperCase();
  if (!raw || raw === "CLEAR") return "—";
  switch (raw) {
    case "FOLGA":
      return "F";
    case "FS":
      return "FS";
    case "FA":
      return "FA";
    case "FP":
      return "FP";
    case "FANI":
      return "FANI";
    case "SIMULADOR":
      return "SIM";
    case "CURSO":
    case "CURSO_ONLINE":
      return "CRS";
    case "REUNIAO_ASSUNTOS":
      return "REUN";
    case "VOO":
      return "VOO";
    case "CMA":
      return "CMA";
    case "OUTRO":
      return "OUTRO";
    case "ND":
      return "ND";
    default:
      return raw;
  }
}
