import { isoDateKey } from "./date-keys.js";
import { iterDays } from "./dates.js";

/** Verifica se uma data civil (yyyy-mm-dd) está no intervalo inclusivo [start, end]. */
export function isIsoDateInInclusiveRange(
  dayIso: string,
  rangeStart: string | Date,
  rangeEnd: string | Date,
): boolean {
  const day = isoDateKey(dayIso);
  const start = isoDateKey(rangeStart);
  const end = isoDateKey(rangeEnd);
  return day >= start && day <= end;
}

/** Expande períodos de férias em dias do mês (início e fim inclusivos). */
export function vacationDaysInMonth(
  vacations: Array<{ employeeId: string; startDate: Date; endDate: Date }>,
  year: number,
  month: number,
): Array<{ employeeUuid: string; date: string }> {
  const days = iterDays(year, month);
  const out: Array<{ employeeUuid: string; date: string }> = [];

  for (const vacation of vacations) {
    const startKey = isoDateKey(vacation.startDate);
    const endKey = isoDateKey(vacation.endDate);
    for (const day of days) {
      if (day >= startKey && day <= endKey) {
        out.push({ employeeUuid: vacation.employeeId, date: day });
      }
    }
  }

  return out;
}
