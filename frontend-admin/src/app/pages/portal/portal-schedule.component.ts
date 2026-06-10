import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ScheduleService } from '../../services/schedule.service';
import { ScheduleGridComponent } from '../../components/schedule-grid/schedule-grid.component';
import { ScheduleLegendComponent } from '../../components/schedule-legend/schedule-legend.component';
import { buildScheduleGrid } from '../../utils/schedule-cell.mapper';
import { applyGridFilters } from '../../utils/schedule-grid.filter';
import { sortEmployeesBySeniority } from '../../utils/employee-sort.util';
import { computeGridAuditTotals } from '../../utils/operational-audit.util';
import type { EmployeeType, ScheduleMonthResponse } from '../../models/api.models';
import type { ScheduleGridData } from '../../models/schedule-grid.models';

@Component({
  selector: 'app-portal-schedule',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputNumberModule,
    SelectModule,
    CheckboxModule,
    TagModule,
    MessageModule,
    ScheduleGridComponent,
    ScheduleLegendComponent,
  ],
  templateUrl: './portal-schedule.component.html',
  styleUrl: './portal-schedule.component.scss',
})
export class PortalScheduleComponent implements OnInit {
  private readonly scheduleService = inject(ScheduleService);

  readonly yearSig = signal(new Date().getFullYear());
  readonly monthSig = signal(new Date().getMonth() + 1);
  readonly loadingView = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly scheduleData = signal<ScheduleMonthResponse | null>(null);

  readonly filterType = signal<'ALL' | EmployeeType>('ALL');
  readonly filterEmployeeId = signal<string | null>(null);
  readonly singleEmployeeOnly = signal(false);

  readonly typeOptions = [
    { label: 'Todos', value: 'ALL' as const },
    { label: 'PAO', value: 'PAO' as const },
    { label: 'APAO', value: 'APAO' as const },
  ];

  readonly periodLabel = computed(() => {
    const y = this.yearSig();
    const m = this.monthSig();
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
    return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} / ${y}`;
  });

  readonly displayGrid = computed((): ScheduleGridData | null => {
    const data = this.scheduleData();
    if (!data) return null;
    const grid = buildScheduleGrid({
      year: this.yearSig(),
      month: this.monthSig(),
      employees: data.employees,
      assignments: data.assignments,
      preAllocations: data.preAllocations,
      operationalCadastros: data.operationalCadastros,
      shifts: data.shifts,
    });
    return applyGridFilters(grid, {
      type: this.filterType(),
      employeeId: this.filterEmployeeId(),
      singleEmployeeOnly: this.singleEmployeeOnly(),
    });
  });

  readonly gridAuditTotals = computed(() => {
    const grid = this.displayGrid();
    const data = this.scheduleData();
    if (!grid) return null;
    return computeGridAuditTotals(grid, data?.assignments ?? []);
  });

  readonly employeeOptions = computed(() => {
    const data = this.scheduleData();
    if (!data) return [];
    const list = sortEmployeesBySeniority(data.employees);
    return [{ label: 'Todos', value: null as string | null }, ...list.map((e) => ({ label: e.name, value: e.id }))];
  });

  ngOnInit(): void {
    this.loadPublishedSchedule();
  }

  loadPublishedSchedule(): void {
    this.loadingView.set(true);
    this.loadError.set(null);
    this.scheduleService.getPublishedSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (data) => {
        this.loadingView.set(false);
        this.scheduleData.set(data);
      },
      error: (err: { error?: { error?: string } }) => {
        this.loadingView.set(false);
        this.scheduleData.set(null);
        this.loadError.set(
          err.error?.error ?? 'Não há escala publicada para o período selecionado.',
        );
      },
    });
  }

  prevMonth(): void {
    const m = this.monthSig();
    const y = this.yearSig();
    if (m === 1) {
      this.monthSig.set(12);
      this.yearSig.set(y - 1);
    } else {
      this.monthSig.set(m - 1);
    }
    this.loadPublishedSchedule();
  }

  nextMonth(): void {
    const m = this.monthSig();
    const y = this.yearSig();
    if (m === 12) {
      this.monthSig.set(1);
      this.yearSig.set(y + 1);
    } else {
      this.monthSig.set(m + 1);
    }
    this.loadPublishedSchedule();
  }

  goToday(): void {
    const now = new Date();
    this.yearSig.set(now.getFullYear());
    this.monthSig.set(now.getMonth() + 1);
    this.loadPublishedSchedule();
  }

  onFiltersChange(): void {
    if (this.singleEmployeeOnly() && !this.filterEmployeeId()) {
      const first = this.scheduleData()?.employees[0];
      if (first) this.filterEmployeeId.set(first.id);
    }
  }

  hasVisibleRows(grid: ScheduleGridData): boolean {
    return grid.groups.some((g) => g.rows.length > 0);
  }

  statusTagSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    if (status === 'PUBLISHED') return 'success';
    return 'secondary';
  }
}
