import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { PortalService } from '../../services/portal.service';
import {
  buildMonthGrid,
  isToday,
  isWeekend,
  monthTitle,
  weekdayLabels,
  type CalendarCell,
} from '../../components/operational-calendar/operational-calendar.utils';
import { dateToIso, formatIsoDate } from '../../utils/date-format';
import {
  expandVacationPeriodsToDays,
  isIsoInInclusiveRange,
  vacationStatusLabel,
} from '../../utils/vacation-calendar.util';
import type {
  PortalVacationCalendarDayEntry,
  PortalVacationCalendarPeriod,
} from '../../models/api.models';

@Component({
  selector: 'app-portal-vacation-request',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, MessageModule, TextareaModule],
  templateUrl: './portal-vacation-request.component.html',
  styleUrl: './portal-vacation-request.component.scss',
})
export class PortalVacationRequestComponent implements OnInit {
  private readonly portalService = inject(PortalService);

  startDate = '';
  endDate = '';
  notes = '';
  sellTenDays: boolean | null = null;
  thirteenthAdvance: boolean | null = null;
  readonly minDate = dateToIso(new Date());
  readonly submitting = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly viewYear = signal(new Date().getFullYear());
  readonly viewMonth = signal(new Date().getMonth() + 1);
  readonly calendarLoading = signal(false);
  readonly calendarError = signal<string | null>(null);
  readonly periods = signal<PortalVacationCalendarPeriod[]>([]);
  readonly selectedDayIso = signal<string | null>(null);

  readonly weekdays = weekdayLabels();
  readonly monthLabel = computed(() => monthTitle(this.viewYear(), this.viewMonth()));
  readonly gridCells = computed(() => buildMonthGrid(this.viewYear(), this.viewMonth()));
  readonly daysByIso = computed(() => expandVacationPeriodsToDays(this.periods()));
  readonly selectedDayEntries = computed(() => {
    const iso = this.selectedDayIso();
    if (!iso) return [];
    return this.daysByIso()[iso] ?? [];
  });
  readonly monthPeriods = computed(() => {
    const prefix = `${this.viewYear()}-${String(this.viewMonth()).padStart(2, '0')}`;
    return this.periods().filter((period) => period.startDate <= `${prefix}-31` && period.endDate >= `${prefix}-01`);
  });

  readonly statusLabel = vacationStatusLabel;
  readonly formatDate = formatIsoDate;

  ngOnInit(): void {
    this.loadCalendar();
  }

  prevMonth(): void {
    if (this.viewMonth() === 1) {
      this.viewYear.update((year) => year - 1);
      this.viewMonth.set(12);
    } else {
      this.viewMonth.update((month) => month - 1);
    }
    this.loadCalendar();
  }

  nextMonth(): void {
    if (this.viewMonth() === 12) {
      this.viewYear.update((year) => year + 1);
      this.viewMonth.set(1);
    } else {
      this.viewMonth.update((month) => month + 1);
    }
    this.loadCalendar();
  }

  entriesFor(cell: CalendarCell): PortalVacationCalendarDayEntry[] {
    return this.daysByIso()[dateToIso(cell.date)] ?? [];
  }

  isWeekendDay(date: Date): boolean {
    return isWeekend(date);
  }

  isTodayDay(date: Date): boolean {
    return isToday(date);
  }

  isInFormRange(date: Date): boolean {
    return isIsoInInclusiveRange(dateToIso(date), this.startDate, this.endDate);
  }

  isSelectedDay(date: Date): boolean {
    return this.selectedDayIso() === dateToIso(date);
  }

  onDayClick(cell: CalendarCell): void {
    const iso = dateToIso(cell.date);
    this.selectedDayIso.set(iso);
    if (iso < this.minDate) return;
    if (!this.startDate || (this.startDate && this.endDate)) {
      this.startDate = iso;
      this.endDate = '';
      return;
    }
    if (iso < this.startDate) {
      this.endDate = this.startDate;
      this.startDate = iso;
      return;
    }
    this.endDate = iso;
  }

  submit(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    if (!this.startDate || !this.endDate) {
      this.errorMessage.set('Informe as datas de início e término das férias.');
      return;
    }
    if (this.endDate < this.startDate) {
      this.errorMessage.set('A data final não pode ser anterior à data inicial.');
      return;
    }
    if (this.sellTenDays === null || this.thirteenthAdvance === null) {
      this.errorMessage.set('Responda às duas opções adicionais antes de enviar.');
      return;
    }

    const [year, month] = this.startDate.split('-').map(Number);
    this.submitting.set(true);
    this.portalService.createRequest({
      year: year!,
      month: month!,
      date: this.startDate,
      endDate: this.endDate,
      type: 'FERIAS',
      notes: this.notes.trim() || undefined,
      sellTenDaysRequested: this.sellTenDays,
      thirteenthAdvanceRequested: this.thirteenthAdvance,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.successMessage.set('Solicitação de férias enviada. Aguarde a aprovação do administrador.');
        this.startDate = '';
        this.endDate = '';
        this.notes = '';
        this.sellTenDays = null;
        this.thirteenthAdvance = null;
        this.loadCalendar();
      },
      error: (err: { error?: { error?: string } }) => {
        this.submitting.set(false);
        this.errorMessage.set(err.error?.error ?? 'Não foi possível enviar a solicitação de férias.');
      },
    });
  }

  private loadCalendar(): void {
    this.calendarLoading.set(true);
    this.calendarError.set(null);
    this.portalService.getVacationCalendar(this.viewYear(), this.viewMonth()).subscribe({
      next: (data) => {
        this.periods.set(data.periods ?? []);
        this.calendarLoading.set(false);
      },
      error: () => {
        this.calendarLoading.set(false);
        this.calendarError.set('Não foi possível carregar os pedidos de férias deste mês.');
      },
    });
  }
}
