export function monthRange(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (m: number) => String(m).padStart(2, "0");
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function iterDays(year: number, month: number): string[] {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (m: number) => String(m).padStart(2, "0");
  const days: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${year}-${pad(month)}-${String(d).padStart(2, "0")}`);
  }
  return days;
}

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, delta: number): string {
  const dt = parseDate(iso);
  dt.setDate(dt.getDate() + delta);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function weekday(iso: string): number {
  return parseDate(iso).getDay();
}

export function isWeekend(iso: string): boolean {
  const w = weekday(iso);
  return w === 0 || w === 6;
}

export function isInMonth(iso: string, year: number, month: number): boolean {
  const { start, end } = monthRange(year, month);
  return iso >= start && iso <= end;
}
