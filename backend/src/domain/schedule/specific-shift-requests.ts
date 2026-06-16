import { weekday } from "../rules/dates.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { SpecificShiftDayPreferenceRow, SpecificShiftRequest } from "./generation-types.js";

/** Expande preferências de dia específico para alocações concretas no mês. */
export function expandSpecificShiftRequests(
  year: number,
  month: number,
  days: readonly string[],
  rows: readonly SpecificShiftDayPreferenceRow[],
): SpecificShiftRequest[] {
  const out: SpecificShiftRequest[] = [];

  for (const row of rows) {
    if (row.year != null && row.year !== year) continue;
    if (row.month != null && row.month !== month) continue;

    const code = row.shiftCode.toUpperCase() as ShiftCode;

    if (row.dayOfMonth != null) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(row.dayOfMonth).padStart(2, "0")}`;
      if (days.includes(date)) {
        out.push({ employeeUuid: row.employeeUuid, date, shiftCode: code });
      }
      continue;
    }

    if (row.weekday != null) {
      for (const date of days) {
        if (weekday(date) === row.weekday) {
          out.push({ employeeUuid: row.employeeUuid, date, shiftCode: code });
        }
      }
    }
  }

  return out;
}
