import { isoDateKey } from "./date-keys.js";

export function operationalLabelPriority(label: string): number {
  const n = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (n.includes("FERIAS")) return 100;
  if (n === "FP" || n.includes("FOLGA PEDIDA")) return 90;
  if (n === "FANI" || n.includes("FOLGA ANIVERS")) return 80;
  if (n.includes("SIMULADOR")) return 70;
  if (n.includes("CURSO")) return 60;
  if (n.includes("CMA")) return 50;
  if (n.includes("VOO")) return 40;
  if (n === "OUTRO") return 30;
  return 20;
}

export interface OperationalCadastroLike {
  employeeId: string;
  date: string;
  label: string;
}

/** Mantém apenas a ocupação dominante por employeeId + data civil. */
export function deduplicateOperationalCadastros<T extends OperationalCadastroLike>(
  rows: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.employeeId}|${isoDateKey(row.date)}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      operationalLabelPriority(row.label) > operationalLabelPriority(existing.label)
    ) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const dateCmp = isoDateKey(a.date).localeCompare(isoDateKey(b.date));
    if (dateCmp !== 0) return dateCmp;
    return a.employeeId.localeCompare(b.employeeId);
  });
}
