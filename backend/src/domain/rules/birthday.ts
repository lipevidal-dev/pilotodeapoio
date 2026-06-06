import { isoDateKey } from "./date-keys.js";

/** Label canônica da folga de aniversário. */
export const FANI_LABEL = "FOLGA ANIVERSÁRIO";

/** Data civil do aniversário dentro de year/month (ajusta 29/02 em anos não bissextos). */
export function birthdayInMonth(
  birthDate: string | null | undefined,
  year: number,
  month: number,
): string | null {
  if (!birthDate) return null;
  const iso = isoDateKey(birthDate);
  const [, birthMonthStr, birthDayStr] = iso.split("-");
  const birthMonth = Number(birthMonthStr);
  const birthDay = Number(birthDayStr);
  if (birthMonth !== month) return null;

  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.min(birthDay, daysInMonth);
  const mo = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${mo}-${d}`;
}
