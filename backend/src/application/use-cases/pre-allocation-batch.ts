import {
  isInvalidPreAllocationLabel,
  normalizePreAllocationLabel,
} from "../../domain/schedule/valid-preallocation-labels.js";

export interface ExistingPreAllocRow {
  id: string;
  scheduleMonthId: string;
  employeeId: string;
  dateIso: string;
  label: string;
}

/** Separa datas novas vs. duplicadas (mesmo mês + funcionário + data + label). */
export function splitPreAllocBatchDates(
  dates: string[],
  scheduleMonthId: string,
  employeeId: string,
  targetLabel: string,
  existing: ExistingPreAllocRow[],
): { toCreate: string[]; skipped: string[]; legacyIdsToRemove: string[] } {
  const normalizedTarget = normalizePreAllocationLabel(targetLabel);
  const uniqueDates = [...new Set(dates)].sort();

  const byDate = new Map<string, ExistingPreAllocRow>();
  for (const row of existing) {
    if (row.scheduleMonthId !== scheduleMonthId || row.employeeId !== employeeId) continue;
    byDate.set(row.dateIso, row);
  }

  const toCreate: string[] = [];
  const skipped: string[] = [];
  const legacyIdsToRemove: string[] = [];

  for (const d of uniqueDates) {
    const row = byDate.get(d);
    if (!row) {
      toCreate.push(d);
      continue;
    }

    const rowLabel = normalizePreAllocationLabel(row.label);
    if (rowLabel === normalizedTarget) {
      skipped.push(d);
      continue;
    }

    if (isInvalidPreAllocationLabel(row.label)) {
      legacyIdsToRemove.push(row.id);
      toCreate.push(d);
      continue;
    }

    skipped.push(d);
  }

  return { toCreate, skipped, legacyIdsToRemove };
}
