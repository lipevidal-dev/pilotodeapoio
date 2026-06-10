import { addDays, iterDays } from "../rules/dates.js";
import { isoDateKey } from "../rules/date-keys.js";

export const CROSS_MONTH_LOOKBACK_DAYS = 15;

export interface CrossMonthAssignment {
  employeeUuid: string;
  date: string;
  shiftCode: string;
}

export interface CrossMonthAllocation {
  employeeUuid: string;
  date: string;
  label: string;
}

export interface CrossMonthHistory {
  assignments: CrossMonthAssignment[];
  allocations: CrossMonthAllocation[];
}

export interface VacationReturnDay {
  employeeUuid: string;
  date: string;
}

export function lookbackStartDate(year: number, month: number): string {
  const first = iterDays(year, month)[0];
  return addDays(first, -(CROSS_MONTH_LOOKBACK_DAYS - 1));
}

export function filterHistoryByLookback<T extends { date: string }>(
  rows: T[],
  year: number,
  month: number,
): T[] {
  const start = lookbackStartDate(year, month);
  const end = iterDays(year, month)[0];
  return rows.filter((r) => r.date >= start && r.date < end);
}

export function assignmentsFromDb(
  rows: Array<{ employeeId: string; date: Date; shiftCode: string }>,
): CrossMonthAssignment[] {
  return rows.map((r) => ({
    employeeUuid: r.employeeId,
    date: isoDateKey(r.date),
    shiftCode: r.shiftCode,
  }));
}

export function allocationsFromDb(
  rows: Array<{ employeeId: string; date: Date; label: string }>,
): CrossMonthAllocation[] {
  return rows.map((r) => ({
    employeeUuid: r.employeeId,
    date: isoDateKey(r.date),
    label: r.label,
  }));
}

/** Mescla alocações evitando duplicatas employee|date|label. */
export function mergeCrossMonthAllocations(
  base: CrossMonthAllocation[],
  extra: CrossMonthAllocation[],
): CrossMonthAllocation[] {
  const seen = new Set(base.map((row) => `${row.employeeUuid}|${row.date}|${row.label.toUpperCase()}`));
  const merged = [...base];
  for (const row of extra) {
    const key = `${row.employeeUuid}|${row.date}|${row.label.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}
