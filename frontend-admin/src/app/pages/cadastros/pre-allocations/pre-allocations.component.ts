import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmationService, MessageService } from 'primeng/api';
import { PreAllocationService } from '../../../services/pre-allocation.service';
import { ScheduleRefreshService } from '../../../services/schedule-refresh.service';
import { EmployeeService } from '../../../services/employee.service';
import { EmployeeOccupancyService } from '../../../services/employee-occupancy.service';
import type { DayOccupancyMap } from '../../../utils/employee-occupancy.util';
import { OperationalCalendarComponent } from '../../../components/operational-calendar/operational-calendar.component';
import { batchResultDetail, batchResultSeverity } from '../../../utils/batch-result.util';
import { datesToIsoList, formatIsoDate } from '../../../utils/date-format';
import type { Employee, PreAllocation } from '../../../models/api.models';

@Component({
  selector: 'app-pre-allocations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    CardModule,
    ButtonModule,
    TagModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    TextareaModule,
    OperationalCalendarComponent,
  ],
  templateUrl: './pre-allocations.component.html',
  styleUrl: '../cadastros-shared.scss',
})
export class PreAllocationsComponent implements OnInit {
  private readonly service = inject(PreAllocationService);
  private readonly employeeService = inject(EmployeeService);
  private readonly occupancyService = inject(EmployeeOccupancyService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly scheduleRefresh = inject(ScheduleRefreshService);

  readonly rows = signal<PreAllocation[]>([]);
  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(false);
  readonly dialogVisible = signal(false);
  readonly saving = signal(false);

  filterYear = new Date().getFullYear();
  filterMonth = new Date().getMonth() + 1;

  formYear = this.filterYear;
  formMonth = this.filterMonth;
  formEmployeeId = '';
  formDates: Date[] = [];
  formLabel = 'SIMULADOR';
  formNotes = '';

  readonly dayOccupancy = signal<DayOccupancyMap>({});
  readonly occupancyLoading = signal(false);

  readonly formatDate = formatIsoDate;

  formMinDate(): Date {
    return new Date(this.formYear, this.formMonth - 1, 1);
  }

  formMaxDate(): Date {
    return new Date(this.formYear, this.formMonth, 0);
  }
  readonly labelOptions = [
    { label: 'Simulador', value: 'SIMULADOR' },
    { label: 'Curso', value: 'CURSO' },
    { label: 'CMA', value: 'CMA' },
    { label: 'Voo (pré-aloc.)', value: 'VOO' },
    { label: 'Outro', value: 'OUTRO' },
  ];

  ngOnInit(): void {
    this.loadEmployees();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.list({ year: this.filterYear, month: this.filterMonth }).subscribe({
      next: (data) => {
        this.rows.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao carregar pré-alocações.' });
      },
    });
  }

  loadEmployees(): void {
    this.employeeService.list().subscribe({
      next: (data) => this.employees.set(data.filter((e) => e.active)),
    });
  }

  labelSeverity(label: string): 'info' | 'warn' | 'secondary' | 'success' {
    switch (label.toUpperCase()) {
      case 'SIMULADOR':
        return 'secondary';
      case 'CURSO':
        return 'warn';
      case 'VOO':
        return 'info';
      case 'CMA':
        return 'success';
      default:
        return 'secondary';
    }
  }

  openNew(): void {
    this.resetForm();
    this.dialogVisible.set(true);
  }

  resetForm(): void {
    this.formYear = this.filterYear;
    this.formMonth = this.filterMonth;
    this.formEmployeeId = '';
    this.formDates = [];
    this.formLabel = 'SIMULADOR';
    this.formNotes = '';
    this.dayOccupancy.set({});
    this.occupancyLoading.set(false);
  }

  onFormPeriodChange(): void {
    this.formDates = [];
    this.reloadOccupancy();
  }

  onEmployeeChange(): void {
    this.formDates = [];
    this.reloadOccupancy();
  }

  private reloadOccupancy(): void {
    if (!this.formEmployeeId) {
      this.dayOccupancy.set({});
      this.occupancyLoading.set(false);
      return;
    }
    const employeeId = this.formEmployeeId;
    const year = this.formYear;
    const month = this.formMonth;
    this.occupancyLoading.set(true);
    this.occupancyService.loadForMonth(employeeId, year, month).subscribe({
      next: (map) => {
        if (this.formEmployeeId === employeeId && this.formYear === year && this.formMonth === month) {
          this.dayOccupancy.set(map);
          this.occupancyLoading.set(false);
        }
      },
      error: () => {
        if (this.formEmployeeId === employeeId) {
          this.dayOccupancy.set({});
          this.occupancyLoading.set(false);
          this.messages.add({
            severity: 'warn',
            summary: 'Calendário',
            detail: 'Não foi possível carregar a ocupação do funcionário neste mês.',
          });
        }
      },
    });
  }

  save(): void {
    if (!this.formEmployeeId || this.formDates.length === 0 || !this.formLabel) {
      this.messages.add({
        severity: 'warn',
        summary: 'Validação',
        detail: 'Preencha funcionário, datas e label.',
      });
      return;
    }
    this.saving.set(true);
    this.service
      .createBatch({
        year: this.formYear,
        month: this.formMonth,
        employeeId: this.formEmployeeId,
        dates: datesToIsoList(this.formDates),
        label: this.formLabel,
        notes: this.formNotes.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.dialogVisible.set(false);
          this.resetForm();
          this.messages.add({
            severity: batchResultSeverity(res),
            summary: res.created > 0 ? 'Criado' : 'Atenção',
            detail: batchResultDetail(res, 'pré-alocação(ões)'),
          });
          if (res.created > 0) {
            this.load();
            this.scheduleRefresh.notify();
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Falha ao criar pré-alocações.',
          });
        },
      });
  }

  confirmDelete(row: PreAllocation): void {
    this.confirm.confirm({
      message: `Excluir ${row.label} de ${row.employee?.name ?? row.employeeId}?`,
      header: 'Confirmar exclusão',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Excluir',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.delete(row.id),
    });
  }

  private delete(id: string): void {
    this.service.delete(id).subscribe({
      next: () => {
        this.messages.add({ severity: 'success', summary: 'Excluído', detail: 'Pré-alocação removida.' });
        this.load();
        this.scheduleRefresh.notify();
      },
      error: () => {
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao excluir.' });
      },
    });
  }
}
