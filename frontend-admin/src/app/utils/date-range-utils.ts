import { dateToIso, sortDatesAsc } from './date-format';

export interface DatePeriod {
  startDate: string;
  endDate: string;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function eachDayInRange(start: Date, end: Date): Date[] {
  const s = startOfDay(start);
  const e = startOfDay(end);
  const lo = s.getTime() <= e.getTime() ? s : e;
  const hi = s.getTime() <= e.getTime() ? e : s;
  const days: Date[] = [];
  const cur = new Date(lo);
  while (cur.getTime() <= hi.getTime()) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function mergeDates(existing: Date[], toAdd: Date[]): Date[] {
  const map = new Map<number, Date>();
  for (const d of [...existing, ...toAdd]) {
    const sod = startOfDay(d);
    map.set(sod.getTime(), sod);
  }
  return sortDatesAsc([...map.values()]);
}

export function toggleDateInList(existing: Date[], day: Date): Date[] {
  const t = startOfDay(day).getTime();
  const has = existing.some((d) => startOfDay(d).getTime() === t);
  if (has) {
    return existing.filter((d) => startOfDay(d).getTime() !== t);
  }
  return mergeDates(existing, [day]);
}

/** Converte datas avulsas em blocos contínuos (ISO yyyy-mm-dd). */
export function datesToContinuousPeriods(dates: Date[]): DatePeriod[] {
  if (dates.length === 0) return [];
  const sorted = sortDatesAsc(dates.map(startOfDay));
  const periods: DatePeriod[] = [];
  let blockStart = sorted[0];
  let blockEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const nextDay = new Date(prev);
    nextDay.setDate(nextDay.getDate() + 1);
    if (isSameDay(nextDay, cur)) {
      blockEnd = cur;
    } else {
      periods.push({ startDate: dateToIso(blockStart), endDate: dateToIso(blockEnd) });
      blockStart = cur;
      blockEnd = cur;
    }
  }
  periods.push({ startDate: dateToIso(blockStart), endDate: dateToIso(blockEnd) });
  return periods;
}

export function formatPeriodsSummaryPt(periods: DatePeriod[]): string {
  return periods
    .map((p) => {
      const start = new Date(`${p.startDate}T12:00:00`);
      const end = new Date(`${p.endDate}T12:00:00`);
      const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (p.startDate === p.endDate) return fmt(start);
      return `${fmt(start)}–${fmt(end)}`;
    })
    .join(', ');
}
