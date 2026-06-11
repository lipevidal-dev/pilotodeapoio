import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmationService, MessageService } from 'primeng/api';
import { RequestedDayOffService } from '../../../services/requested-day-off.service';
import { ScheduleRefreshService } from '../../../services/schedule-refresh.service';
import { EmployeeOccupancyService } from '../../../services/employee-occupancy.service';
import { EmployeeService } from '../../../services/employee.service';
import type { DayOccupancyMap } from '../../../utils/employee-occupancy.util';
import { sortEmployeesBySeniority } from '../../../utils/employee-sort.util';
import { OperationalCalendarComponent } from '../../../components/operational-calendar/operational-calendar.component';
import { CadastroEmployeeFilterComponent } from '../../../components/cadastro-employee-filter/cadastro-employee-filter.component';
import { filterCadastroRowsByEmployee } from '../../../utils/cadastro-list-filter.util';
import {
  batchDeleteDetail,
  batchResultDetail,
  batchResultSeverity,
} from '../../../utils/batch-result.util';
import { datesToIsoList, formatIsoDate } from '../../../utils/date-format';
import type { Employee, RequestedDayOff, RequestedDayOffStatus, UpdateRequestedDayOffPayload } from '../../../models/api.models';

@Component({
  selector: 'app-requested-day-offs',
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
    TextareaModule,
    OperationalCalendarComponent,
    CadastroEmployeeFilterComponent,
  ],
  templateUrl: './requested-day-offs.component.html',
  styleUrl: '../cadastros-shared.scss',
})
export class RequestedDayOffsComponent implements OnInit {
  private readonly service = inject(RequestedDayOffService);
  private readonly employeeService = inject(EmployeeService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly scheduleRefresh = inject(ScheduleRefreshService);
  private readonly occupancyService = inject(EmployeeOccupancyService);

  readonly rows = signal<RequestedDayOff[]>([]);
  readonly employees = signal<Employee[]>([]);
  readonly filterEmployeeId = signal('');
  readonly filteredRows = computed(() =>
    filterCadastroRowsByEmployee(
      this.rows(),
      this.filterEmployeeId(),
      (row) => row.employeeId,
    ),
  );
  readonly loading = signal(false);
  readonly dialogVisible = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly isEditing = computed(() => !!this.editingId());
  readonly saving = signal(false);
  readonly deletingBatch = signal(false);

  selectedRows: RequestedDayOff[] = [];

  formEmployeeId = '';
  formDates: Date[] = [];
  formStatus: RequestedDayOffStatus = 'APPROVED';
  formNotes = '';

  readonly dayOccupancy = signal<DayOccupancyMap>({});
  readonly occupancyLoading = signal(false);
  readonly calendarYear = signal(new Date().getFullYear());
  readonly calendarMonth = signal(new Date().getMonth() + 1);

  readonly formatDate = formatIsoDate;
  readonly statusOptions = [
    { label: 'Aprovada', value: 'APPROVED' as const },
    { label: 'Pendente', value: 'PENDING' as const },
    { label: 'Rejeitada', value: 'REJECTED' as const },
  ];

  onFilterEmployeeChange(employeeId: string): void {
    this.filterEmployeeId.set(employeeId);
    this.selectedRows = [];
  }

  ngOnInit(): void {
    this.loadEmployees();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (data) => {
        this.rows.set(data);
        this.selectedRows = [];
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao carregar FPs.' });
      },
    });
  }

  loadEmployees(): void {
    this.employeeService.list().subscribe({
      next: (data) => this.employees.set(sortEmployeesBySeniority(data.filter((e) => e.active))),
    });
  }

  statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'APPROVED':
        return 'success';
      case 'PENDING':
        return 'warn';
      case 'REJECTED':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  dialogTitle(): string {
    return this.isEditing() ? 'Editar folga pedida' : 'Nova folga pedida';
  }

  onDialogVisibleChange(visible: boolean): void {
    this.dialogVisible.set(visible);
    if (!visible) {
      this.resetForm();
    }
  }

  openNew(): void {
    this.resetForm();
    this.dialogVisible.set(true);
  }

  openEdit(row: RequestedDayOff): void {
    this.editingId.set(row.id);
    const iso = row.date.slice(0, 10);
    const d = new Date(`${iso}T12:00:00`);
    this.formEmployeeId = row.employeeId;
    this.formDates = [d];
    this.formStatus = row.status;
    this.formNotes = row.notes ?? '';
    this.calendarYear.set(d.getFullYear());
    this.calendarMonth.set(d.getMonth() + 1);
    this.dialogVisible.set(true);
    this.reloadOccupancy();
  }

  resetForm(): void {
    this.editingId.set(null);
    this.formEmployeeId = '';
    this.formDates = [];
    this.formStatus = 'APPROVED';
    this.formNotes = '';
    this.dayOccupancy.set({});
    this.occupancyLoading.set(false);
    const now = new Date();
    this.calendarYear.set(now.getFullYear());
    this.calendarMonth.set(now.getMonth() + 1);
  }

  onEmployeeChange(): void {
    this.formDates = [];
    this.reloadOccupancy();
  }

  onCalendarPeriodChange(period: { year: number; month: number }): void {
    this.calendarYear.set(period.year);
    this.calendarMonth.set(period.month);
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
    const year = this.calendarYear();
    const month = this.calendarMonth();
    this.occupancyLoading.set(true);
    this.occupancyService.loadForMonth(employeeId, year, month).subscribe({
      next: (map) => {
        if (this.formEmployeeId === employeeId) {
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
        detail: 'Selecione funcionário e ao menos uma data.',
      });
      return;
    }
    this.saving.set(true);

    if (this.isEditing()) {
      const updatePayload: UpdateRequestedDayOffPayload = {
        employeeId: this.formEmployeeId,
        date: datesToIsoList(this.formDates)[0],
        status: this.formStatus,
        notes: this.formNotes.trim() || null,
      };
      this.service.update(this.editingId()!, updatePayload).subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogVisible.set(false);
          this.messages.add({ severity: 'success', summary: 'Atualizado', detail: 'FP atualizada.' });
          this.load();
          this.scheduleRefresh.notify();
        },
        error: (err) => {
          this.saving.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Falha ao atualizar FP.',
          });
        },
      });
      return;
    }

    this.service
      .createBatch({
        employeeId: this.formEmployeeId,
        dates: datesToIsoList(this.formDates),
        status: this.formStatus,
        notes: this.formNotes.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.dialogVisible.set(false);
          this.messages.add({
            severity: batchResultSeverity(res),
            summary: res.created > 0 ? 'Criado' : 'Atenção',
            detail: batchResultDetail(res, 'FP'),
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
            detail: err.error?.error ?? 'Falha ao criar FPs.',
          });
        },
      });
  }

  confirmDelete(row: RequestedDayOff): void {
    this.confirm.confirm({
      message: `Excluir FP de ${row.employee?.name ?? row.employeeId} em ${formatIsoDate(row.date)}?`,
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
        this.messages.add({ severity: 'success', summary: 'Excluído', detail: 'FP removida.' });
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
          detail: batchDeleteDetail(res, 'FP'),
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
