import { addDays } from "../rules/dates.js";

export interface T8BlockDates {
  start: string;
  t8First: string;
  t8Second: string;
  nd: string;
}

export function isDateInScheduleMonth(date: string, year: number, month: number): boolean {
  const [y, m] = date.split("-").map(Number);
  return y === year && m === month;
}

export function t8BlockFromStart(startDate: string): T8BlockDates {
  return {
    start: startDate,
    t8First: startDate,
    t8Second: addDays(startDate, 1),
    nd: addDays(startDate, 2),
  };
}

/** Agrupa dias selecionados em inícios de bloco T8/T8/ND (evita triplicar bloco). */
export function normalizeT8BlockStarts(dates: string[]): string[] {
  const sorted = [...new Set(dates)].sort();
  const starts: string[] = [];
  for (const date of sorted) {
    const prevStart = addDays(date, -1);
    const prev2Start = addDays(date, -2);
    if (starts.includes(prevStart) || starts.includes(prev2Start)) continue;
    starts.push(date);
  }
  return starts;
}

/** Resolve o primeiro dia T8 do bloco a partir de qualquer célula do bloco. */
export function resolveT8BlockStart(
  shiftCode: string | undefined,
  preallocLabel: string | undefined,
  date: string,
  shiftOn: (day: string) => string | undefined,
): string | null {
  const label = (preallocLabel ?? "").toUpperCase();
  if (label === "ND") {
    const d1 = addDays(date, -1);
    const d0 = addDays(date, -2);
    if (shiftOn(d1) === "T8" && shiftOn(d0) === "T8") return d0;
    return null;
  }
  if (shiftCode !== "T8") return null;
  const prev = shiftOn(addDays(date, -1));
  if (prev === "T8") {
    const prev2 = shiftOn(addDays(date, -2));
    if (prev2 === "T8") return null;
    return addDays(date, -1);
  }
  return date;
}
