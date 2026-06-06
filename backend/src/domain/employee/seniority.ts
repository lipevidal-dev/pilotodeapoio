import type { EmployeeType } from "@prisma/client";

/** PAO: "1"; APAO: "1A" */
export function formatSeniorityLabel(type: EmployeeType | string, seniorityNumber: number): string {
  return String(type).toUpperCase() === "APAO"
    ? `${seniorityNumber}A`
    : String(seniorityNumber);
}

export function typeSortOrder(type: EmployeeType | string): number {
  const upper = String(type).toUpperCase();
  if (upper === "PAO") return 0;
  if (upper === "APAO") return 1;
  return 2;
}

export function compareEmployeesBySeniority<
  T extends { type: EmployeeType | string; seniorityNumber?: number | null; name: string },
>(a: T, b: T): number {
  const byType = typeSortOrder(a.type) - typeSortOrder(b.type);
  if (byType !== 0) return byType;

  const sa = a.seniorityNumber ?? Number.MAX_SAFE_INTEGER;
  const sb = b.seniorityNumber ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;

  return a.name.localeCompare(b.name, "pt-BR");
}

export function normalizeSeniorityInput(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Math.floor(value);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/** Reordena IDs mantendo sequência 1..N (índice 0-based na lista = senioridade 1). */
export function reorderIdsInGroup(ids: string[], movedId: string, targetPosition: number): string[] {
  const fromIdx = ids.indexOf(movedId);
  if (fromIdx < 0) return [...ids];

  const next = [...ids];
  next.splice(fromIdx, 1);
  const insertAt = Math.min(Math.max(targetPosition - 1, 0), next.length);
  next.splice(insertAt, 0, movedId);
  return next;
}

export function insertIdAtPosition(ids: string[], newId: string, targetPosition: number): string[] {
  const next = [...ids];
  const insertAt = Math.min(Math.max(targetPosition - 1, 0), next.length);
  next.splice(insertAt, 0, newId);
  return next;
}
