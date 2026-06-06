import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmationService, MessageService } from 'primeng/api';
import {
  CmaService,
  CourseService,
  LabeledPreAllocationService,
  OtherOperationalAllocationService,
  SimulatorService,
} from '../../../services/labeled-pre-allocation.service';
import { EmployeeService } from '../../../services/employee.service';
import { EmployeeOccupancyService } from '../../../services/employee-occupancy.service';
import { ScheduleRefreshService } from '../../../services/schedule-refresh.service';
import type { DayOccupancyMap } from '../../../utils/employee-occupancy.util';
import { sortEmployeesBySeniority } from '../../../utils/employee-sort.util';
import { OperationalCalendarComponent } from '../../../components/operational-calendar/operational-calendar.component';
import {
  batchDeleteDetail,
  batchResultDetail,
  batchResultSeverity,
} from '../../../utils/batch-result.util';
import { datesToIsoList, formatIsoDate } from '../../../utils/date-format';
import type { Employee, PreAllocation } from '../../../models/api.models';

export interface LabeledCadastroRouteData {
  title: string;
  subtitle: string;
  label: string;
  icon: string;
  resource: 'simulators' | 'courses' | 'cmas' | 'other-operational-allocations';
  tagSeverity: 'info' | 'warn' | 'secondary' | 'success';
  entityLabel: string;
}

@Component({
  selector: 'app-labeled-pre-allocation',
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
  templateUrl: './labeled-pre-allocation.component.html',
  styleUrl: '../cadastros-shared.scss',
})
export class LabeledPreAllocationComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly simulatorService = inject(SimulatorService);
  private readonly courseService = inject(CourseService);
  private readonly cmaService = inject(CmaService);
  private readonly otherService = inject(OtherOperationalAllocationService);
  private readonly employeeService = inject(EmployeeService);
  private readonly occupancyService = inject(EmployeeOccupancyService);
  private readonly scheduleRefresh = inject(ScheduleRefreshService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly config = this.route.snapshot.data as LabeledCadastroRouteData;

  readonly rows = signal<PreAllocation[]>([]);
  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(false);
  readonly dialogVisible = signal(false);
  readonly saving = signal(false);
  readonly deletingBatch = signal(false);

  selectedRows: PreAllocation[] = [];

  filterYear = new Date().getFullYear();
  filterMonth = new Date().getMonth() + 1;

  formYear = this.filterYear;
  formMonth = this.filterMonth;
  formEmployeeId = '';
  formDates: Date[] = [];
  formNotes = '';

  readonly dayOccupancy = signal<DayOccupancyMap>({});
  readonly occupancyLoading = signal(false);
  readonly formatDate = formatIsoDate;

  private get service(): LabeledPreAllocationService {
    switch (this.config.resource) {
      case 'simulators':
        return this.simulatorService;
      case 'courses':
        return this.courseService;
      case 'cmas':
        return this.cmaService;
      default:
        return this.otherService;
    }
  }

  formMinDate(): Date {
    return new Date(this.formYear, this.formMonth - 1, 1);
  }

  formMaxDate(): Date {
    return new Date(this.formYear, this.formMonth, 0);
  }

  ngOnInit(): void {
    this.loadEmployees();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.list({ year: this.filterYear, month: this.filterMonth }).subscribe({
      next: (data) => {
        this.rows.set(data);
        this.selectedRows = [];
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: `Falha ao carregar ${this.config.title.toLowerCase()}.`,
        });
      },
    });
  }

  loadEmployees(): void {
    this.employeeService.list().subscribe({
      next: (data) => this.employees.set(sortEmployeesBySeniority(data.filter((e) => e.active))),
    });
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
        }
      },
    });
  }

  save(): void {
    if (!this.formEmployeeId || this.formDates.length === 0) {
      this.messages.add({
        severity: 'warn',
        summary: 'Validação',
        detail: 'Preencha funcionário e datas.',
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
            detail: batchResultDetail(res, this.config.entityLabel),
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
            detail: err.error?.error ?? `Falha ao criar ${this.config.title.toLowerCase()}.`,
          });
        },
      });
  }

  confirmDelete(row: PreAllocation): void {
    this.confirm.confirm({
      message: `Excluir ${this.config.title} de ${row.employee?.name ?? row.employeeId}?`,
      header: 'Confirmar exclusão',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Excluir',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.delete(row.id),
    });
  }

  confirmDeleteSelected(): void {
    if (this.selectedRows.length === 0) return;
    this.confirm.confirm({
      message: `Excluir ${this.selectedRows.length} registro(s) selecionado(s)?`,
      header: 'Confirmar exclusão em lote',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Excluir',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteSelected(),
    });
  }

  private delete(id: string): void {
    this.service.delete(id).subscribe({
      next: () => {
        this.messages.add({
          severity: 'success',
          summary: 'Excluído',
          detail: `${this.config.title} removido.`,
        });
        this.load();
        this.scheduleRefresh.notify();
      },
      error: () => {
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao excluir.' });
      },
    });
  }

  private deleteSelected(): void {
    const ids = this.selectedRows.map((r) => r.id);
    this.deletingBatch.set(true);
    this.service.deleteBatch(ids).subscribe({
      next: (res) => {
        this.deletingBatch.set(false);
        this.messages.add({
          severity: res.failed.length > 0 ? 'warn' : 'success',
          summary: res.failed.length > 0 ? 'Parcial' : 'Excluído',
          detail: batchDeleteDetail(res, this.config.entityLabel),
        });
        if (res.deleted > 0) {
          this.load();
          this.scheduleRefresh.notify();
        }
      },
      error: () => {
        this.deletingBatch.set(false);
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao excluir selecionados.' });
      },
    });
  }
}
