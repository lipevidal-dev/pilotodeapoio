import {
  Component,
  effect,
  HostListener,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { formatDatesSummaryPt } from '../../utils/date-format';
import {
  eachDayInRange,
  isSameDay,
  mergeDates,
  startOfDay,
  toggleDateInList,
} from '../../utils/date-range-utils';
import {
  buildMonthGrid,
  isToday,
  isWeekend,
  monthTitle,
  weekdayLabels,
  type CalendarCell,
} from './operational-calendar.utils';
import { dateToIso } from '../../utils/date-format';
import type { DayOccupancyMap } from '../../utils/employee-occupancy.util';

export type CalendarMode = 'single' | 'multiple' | 'range';

@Component({
  selector: 'app-operational-calendar',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './operational-calendar.component.html',
  styleUrl: './operational-calendar.component.scss',
})
export class OperationalCalendarComponent {
  readonly mode = input<CalendarMode>('multiple');
  readonly enableDragSelect = input(true);
  readonly hint = input('Selecione uma ou mais datas');
  readonly minDate = input<Date | null>(null);
  readonly maxDate = input<Date | null>(null);
  readonly disabledDates = input<Date[]>([]);
  readonly dayOccupancy = input<DayOccupancyMap>({});
  readonly syncYear = input<number | null>(null);
  readonly syncMonth = input<number | null>(null);

  readonly selectedDates = model<Date[]>([]);
  readonly rangeSelected = output<{ start: Date; end: Date }>();
  readonly selectionCleared = output<void>();
  readonly viewPeriodChange = output<{ year: number; month: number }>();

  readonly viewYear = signal(new Date().getFullYear());
  readonly viewMonth = signal(new Date().getMonth() + 1);

  private dragAnchor: Date | null = null;
  private dragMoved = false;
  private isDragging = false;
  readonly previewDates = signal<Date[]>([]);

  readonly weekdays = weekdayLabels();

  constructor() {
    effect(() => {
      const y = this.syncYear();
      const m = this.syncMonth();
      if (y != null && m != null) {
        this.viewYear.set(y);
        this.viewMonth.set(m);
      }
    });
  }

  gridCells(): CalendarCell[] {
    return buildMonthGrid(this.viewYear(), this.viewMonth());
  }

  title(): string {
    return monthTitle(this.viewYear(), this.viewMonth());
  }

  datesSummary(): string {
    const selected = this.selectedDates();
    if (this.mode() === 'range' && selected.length >= 2) {
      const sorted = [...selected].sort((a, b) => a.getTime() - b.getTime());
      const start = sorted[0];
      const end = sorted[sorted.length - 1];
      const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (isSameDay(start, end)) return fmt(start);
      return `${fmt(start)} – ${fmt(end)}`;
    }
    return formatDatesSummaryPt(selected);
  }

  selectionCount(): number {
    const selected = this.selectedDates();
    if (this.mode() === 'range' && selected.length >= 2) {
      const sorted = [...selected].sort((a, b) => a.getTime() - b.getTime());
      return eachDayInRange(sorted[0], sorted[sorted.length - 1]).length;
    }
    return selected.length;
  }

  isSelected(date: Date): boolean {
    const selected = this.selectedDates();
    if (this.mode() === 'range' && selected.length >= 2) {
      const sorted = [...selected].sort((a, b) => a.getTime() - b.getTime());
      return eachDayInRange(sorted[0], sorted[sorted.length - 1]).some((d) => isSameDay(d, date));
    }
    const t = startOfDay(date).getTime();
    return selected.some((d) => startOfDay(d).getTime() === t);
  }

  isPreview(date: Date): boolean {
    const t = startOfDay(date).getTime();
    return this.previewDates().some((d) => startOfDay(d).getTime() === t);
  }

  isDisabled(date: Date): boolean {
    if (!this.cellEnabled(date)) return true;
    if (this.isOccupiedBlocked(date)) return true;
    const min = this.minDate();
    const max = this.maxDate();
    const sod = startOfDay(date);
    if (min && sod < startOfDay(min)) return true;
    if (max && sod > startOfDay(max)) return true;
    return this.disabledDates().some((d) => isSameDay(d, date));
  }

  dayKey(date: Date): string {
    return dateToIso(startOfDay(date));
  }

  occupancyFor(date: Date) {
    return this.dayOccupancy()[this.dayKey(date)];
  }

  isOccupiedBlocked(date: Date): boolean {
    return this.occupancyFor(date)?.blocked ?? false;
  }

  occupancyBadge(date: Date): string {
    return this.occupancyFor(date)?.display ?? '';
  }

  badgeKindClass(date: Date): string {
    const kind = this.occupancyFor(date)?.kind;
    return kind ? `kind-${kind}` : '';
  }

  cellTitle(date: Date): string {
    const occ = this.occupancyFor(date);
    if (!occ) return '';
    return occ.title ?? occ.display;
  }

  cellEnabled(date: Date): boolean {
    return true;
  }

  isWeekendDay(date: Date): boolean {
    return isWeekend(date);
  }

  isTodayDay(date: Date): boolean {
    return isToday(date);
  }

  prevMonth(): void {
    if (this.viewMonth() === 1) {
      this.viewYear.update((y) => y - 1);
      this.viewMonth.set(12);
    } else {
      this.viewMonth.update((m) => m - 1);
    }
    this.emitViewPeriod();
  }

  nextMonth(): void {
    if (this.viewMonth() === 12) {
      this.viewYear.update((y) => y + 1);
      this.viewMonth.set(1);
    } else {
      this.viewMonth.update((m) => m + 1);
    }
    this.emitViewPeriod();
  }

  goToday(): void {
    const now = new Date();
    this.viewYear.set(now.getFullYear());
    this.viewMonth.set(now.getMonth() + 1);
    this.emitViewPeriod();
  }

  private emitViewPeriod(): void {
    this.viewPeriodChange.emit({ year: this.viewYear(), month: this.viewMonth() });
  }

  clearSelection(): void {
    this.selectedDates.set([]);
    this.previewDates.set([]);
    this.selectionCleared.emit();
  }

  onDayMouseDown(date: Date, event: MouseEvent): void {
    if (this.isDisabled(date)) return;
    event.preventDefault();
    this.dragAnchor = startOfDay(date);
    this.dragMoved = false;
    this.isDragging = true;
    this.updatePreview(this.dragAnchor, this.dragAnchor);
  }

  onDayMouseEnter(date: Date): void {
    if (!this.isDragging || !this.dragAnchor || this.isDisabled(date)) return;
    if (!isSameDay(date, this.dragAnchor)) {
      this.dragMoved = true;
    }
    this.updatePreview(this.dragAnchor, date);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    if (!this.isDragging || !this.dragAnchor) {
      this.isDragging = false;
      return;
    }

    const anchor = this.dragAnchor;
    const preview = this.previewDates();

    if (this.dragMoved && preview.length > 0 && this.enableDragSelect()) {
      this.applyDragSelection(anchor, preview);
    } else if (!this.dragMoved) {
      this.applyClickSelection(anchor);
    }

    this.isDragging = false;
    this.dragAnchor = null;
    this.dragMoved = false;
    this.previewDates.set([]);
  }

  private updatePreview(start: Date, end: Date): void {
    this.previewDates.set(eachDayInRange(start, end).filter((d) => !this.isDisabled(d)));
  }

  private applyClickSelection(day: Date): void {
    const mode = this.mode();
    if (mode === 'single') {
      this.selectedDates.set([day]);
      return;
    }
    if (mode === 'range') {
      const current = this.selectedDates();
      if (current.length === 0) {
        this.selectedDates.set([day]);
        return;
      }
      if (current.length === 1) {
        const range = eachDayInRange(current[0], day);
        const start = range[0];
        const end = range[range.length - 1];
        this.selectedDates.set([start, end]);
        this.rangeSelected.emit({ start, end });
        return;
      }
      this.selectedDates.set([day]);
      return;
    }
    this.selectedDates.set(toggleDateInList(this.selectedDates(), day));
  }

  private applyDragSelection(anchor: Date, preview: Date[]): void {
    const mode = this.mode();
    if (mode === 'single') {
      this.selectedDates.set([preview[0]]);
      return;
    }
    if (mode === 'range') {
      const start = preview[0];
      const end = preview[preview.length - 1];
      this.selectedDates.set([start, end]);
      this.rangeSelected.emit({ start, end });
      return;
    }
    this.selectedDates.set(mergeDates(this.selectedDates(), preview));
  }
}
