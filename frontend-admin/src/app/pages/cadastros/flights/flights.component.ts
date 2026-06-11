import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmationService, MessageService } from 'primeng/api';
import { FlightAssignmentService } from '../../../services/flight-assignment.service';
import { ScheduleRefreshService } from '../../../services/schedule-refresh.service';
import { ScheduleWorkspaceService } from '../../../services/schedule-workspace.service';
import { EmployeeService } from '../../../services/employee.service';
import { EmployeeOccupancyService } from '../../../services/employee-occupancy.service';
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
import type { Employee, FlightAssignment, UpdateFlightAssignmentPayload } from '../../../models/api.models';

@Component({
  selector: 'app-flights',
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
    InputTextModule,
    OperationalCalendarComponent,
    CadastroEmployeeFilterComponent,
  ],
  templateUrl: './flights.component.html',
  styleUrl: '../cadastros-shared.scss',
})
export class FlightsComponent implements OnInit {
  private readonly service = inject(FlightAssignmentService);
  private readonly employeeService = inject(EmployeeService);
  private readonly occupancyService = inject(EmployeeOccupancyService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly scheduleRefresh = inject(ScheduleRefreshService);
  private readonly workspace = inject(ScheduleWorkspaceService);

  readonly rows = signal<FlightAssignment[]>([]);
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

  selectedRows: FlightAssignment[] = [];

  formEmployeeId = '';
  formDates: Date[] = [];
  formDescription = '';

  readonly dayOccupancy = signal<DayOccupancyMap>({});
  readonly occupancyLoading = signal(false);
  readonly calendarYear = signal(this.workspace.year());
  readonly calendarMonth = signal(this.workspace.month());

  readonly formatDate = formatIsoDate;

  onFilterEmployeeChange(employeeId: string): void {
    this.filterEmployeeId.set(employeeId);
    this.selectedRows = [];
  }

  ngOnInit(): void {
    this.calendarYear.set(this.workspace.year());
    this.calendarMonth.set(this.workspace.month());
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
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao carregar voos.' });
      },
    });
  }

  loadEmployees(): void {
    this.employeeService.list().subscribe({
      next: (data) => this.employees.set(sortEmployeesBySeniority(data.filter((e) => e.active))),
    });
  }

  dialogTitle(): string {
    return this.isEditing() ? 'Editar voo' : 'Novo voo';
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

  openEdit(row: FlightAssignment): void {
    this.editingId.set(row.id);
    const iso = row.date.slice(0, 10);
    const d = new Date(`${iso}T12:00:00`);
    this.formEmployeeId = row.employeeId;
    this.formDates = [d];
    this.formDescription = row.description ?? '';
    this.calendarYear.set(d.getFullYear());
    this.calendarMonth.set(d.getMonth() + 1);
    this.dialogVisible.set(true);
    this.reloadOccupancy();
  }

  resetForm(): void {
    this.editingId.set(null);
    this.formEmployeeId = '';
    this.formDates = [];
    this.formDescription = '';
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
      const updatePayload: UpdateFlightAssignmentPayload = {
        employeeId: this.formEmployeeId,
        date: datesToIsoList(this.formDates)[0],
        description: this.formDescription.trim() || null,
      };
      this.service.update(this.editingId()!, updatePayload).subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogVisible.set(false);
          this.messages.add({ severity: 'success', summary: 'Atualizado', detail: 'Voo atualizado.' });
          this.workspace.year.set(this.calendarYear());
          this.workspace.month.set(this.calendarMonth());
          this.load();
          this.scheduleRefresh.notify();
        },
        error: (err) => {
          this.saving.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Falha ao atualizar voo.',
          });
        },
      });
      return;
    }

    this.service
      .createBatch({
        employeeId: this.formEmployeeId,
        dates: datesToIsoList(this.formDates),
        description: this.formDescription.trim() || undefined,
        source: 'MANUAL',
      })
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.dialogVisible.set(false);
          this.messages.add({
            severity: batchResultSeverity(res),
            summary: res.created > 0 ? 'Criado' : 'Atenção',
            detail: batchResultDetail(res, 'voo'),
          });
          if (res.created > 0) {
            this.workspace.year.set(this.calendarYear());
            this.workspace.month.set(this.calendarMonth());
            this.load();
            this.scheduleRefresh.notify();
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Falha ao criar voos.',
          });
        },
      });
  }

  confirmDelete(row: FlightAssignment): void {
    this.confirm.confirm({
      message: `Excluir voo de ${row.employee?.name ?? row.employeeId} em ${formatIsoDate(row.date)}?`,
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
        this.messages.add({ severity: 'success', summary: 'Excluído', detail: 'Voo removido.' });
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
          detail: batchDeleteDetail(res, 'voo'),
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
