import { startOfDay } from '../../utils/date-range-utils';

export interface CalendarCell {
  date: Date;
  inMonth: boolean;
}

const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function weekdayLabels(): string[] {
  return WEEKDAYS_PT;
}

export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(year, month - 1, 1 - startOffset);
  const cells: CalendarCell[] = [];

  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    cells.push({
      date: startOfDay(date),
      inMonth: date.getMonth() === month - 1,
    });
  }

  return cells;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isToday(date: Date): boolean {
  return startOfDay(date).getTime() === startOfDay(new Date()).getTime();
}

export function monthTitle(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
