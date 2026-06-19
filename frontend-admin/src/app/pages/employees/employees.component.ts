import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { TableModule } from 'primeng/table';

import { CardModule } from 'primeng/card';

import { ButtonModule } from 'primeng/button';

import { TagModule } from 'primeng/tag';

import { DialogModule } from 'primeng/dialog';

import { InputTextModule } from 'primeng/inputtext';

import { InputNumberModule } from 'primeng/inputnumber';

import { SelectModule } from 'primeng/select';

import { MultiSelectModule } from 'primeng/multiselect';

import { SelectButtonModule } from 'primeng/selectbutton';

import { CheckboxModule } from 'primeng/checkbox';

import { DatePickerModule } from 'primeng/datepicker';

import { MessageModule } from 'primeng/message';

import { ConfirmationService, MessageService } from 'primeng/api';

import { EmployeeService } from '../../services/employee.service';

import { RoleService } from '../../services/role.service';

import { ShiftService } from '../../services/shift.service';

import { OperationalCalendarComponent } from '../../components/operational-calendar/operational-calendar.component';

import { buildMonthGrid } from '../../components/operational-calendar/operational-calendar.utils';

import { dateToIso, formatIsoDate } from '../../utils/date-format';

import { mergeDates } from '../../utils/date-range-utils';

import { formatSeniorityLabel, sortEmployeesBySeniority } from '../../utils/employee-sort.util';

import type { CreateEmployeePayload, Employee, JobRole, Shift } from '../../models/api.models';
import { asRateioShiftCode, isRateioShiftCode, RATEIO_SHIFT_ORDER, type RateioShiftCode } from '../../utils/shift-code.util';



type EmployeeFilter = 'all' | 'active' | 'inactive' | string;

type DialogMode = 'create' | 'edit';



@Component({

  selector: 'app-employees',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    TableModule,

    CardModule,

    ButtonModule,

    TagModule,

    DialogModule,

    InputTextModule,

    InputNumberModule,

    SelectModule,

    MultiSelectModule,

    SelectButtonModule,

    CheckboxModule,

    DatePickerModule,

    MessageModule,

    OperationalCalendarComponent,

  ],

  templateUrl: './employees.component.html',

  styleUrl: './employees.component.scss',

})

export class EmployeesComponent implements OnInit {

  private readonly employeeService = inject(EmployeeService);

  private readonly roleService = inject(RoleService);

  private readonly shiftService = inject(ShiftService);

  private readonly messages = inject(MessageService);

  private readonly confirm = inject(ConfirmationService);



  readonly employees = signal<Employee[]>([]);

  readonly roles = signal<JobRole[]>([]);

  readonly shifts = signal<Shift[]>([]);

  readonly loading = signal(false);

  readonly dialogVisible = signal(false);

  readonly saving = signal(false);

  readonly loadingDetail = signal(false);



  dialogMode: DialogMode = 'create';

  editingId = '';

  formName = '';

  formRoleId = '';

  formBirthDate: Date | null = null;

  formSeniorityNumber: number | null = null;

  formActive = true;

  formNoFlightDates: Date[] = [];

  formRestrictedShiftIds: string[] = [];

  /** Preferência principal (T6/T7/T8/T9) — persiste em preferredShiftIds. */
  formPrimaryPreferredShiftId: string | null = null;

  formIsFcf = false;

  formFcfSchedule: Array<{ shiftId: string; weekday: number }> = [];

  readonly fcfWeekdayOptions = [
    { label: 'Segunda', value: 1 },
    { label: 'Terça', value: 2 },
    { label: 'Quarta', value: 3 },
    { label: 'Quinta', value: 4 },
    { label: 'Sexta', value: 5 },
    { label: 'Sábado', value: 6 },
    { label: 'Domingo', value: 0 },
  ];

  readonly weekdayOptions = [
    { label: 'Domingo', value: 0 },
    { label: 'Segunda', value: 1 },
    { label: 'Terça', value: 2 },
    { label: 'Quarta', value: 3 },
    { label: 'Quinta', value: 4 },
    { label: 'Sexta', value: 5 },
    { label: 'Sábado', value: 6 },
  ];

  calendarViewYear = new Date().getFullYear();

  calendarViewMonth = new Date().getMonth() + 1;

  filter = signal<EmployeeFilter>('all');



  readonly filterOptions = computed(() => {

    const base = [

      { label: 'Todos', value: 'all' as const },

      { label: 'Ativos', value: 'active' as const },

      { label: 'Inativos', value: 'inactive' as const },

    ];

    const cargoFilters = this.roles().map((r) => ({ label: r.code, value: r.code }));

    return [...base, ...cargoFilters];

  });



  readonly cargoOptions = computed(() =>

    this.roles()

      .filter((r) => r.active)

      .map((r) => ({

        label: `${r.code} — ${r.name}`,

        value: r.id,

      })),

  );



  readonly shiftOptions = computed(() =>

    this.shifts()

      .filter((s) => s.active)

      .map((s) => ({

        label: `${s.code} — ${s.name}`,

        value: s.id,

        code: s.code.toUpperCase(),

      })),

  );



  readonly rateioShiftOptions = computed(() =>
    this.shiftOptions()
      .filter(
        (s): s is { label: string; value: string; code: RateioShiftCode } =>
          isRateioShiftCode(s.code),
      )
      .sort((a, b) => (RATEIO_SHIFT_ORDER.get(a.code) ?? 99) - (RATEIO_SHIFT_ORDER.get(b.code) ?? 99)),
  );



  readonly primaryShiftOptions = computed(() => [

    { label: 'Nenhuma', value: null as string | null },

    ...this.rateioShiftOptions().map((s) => ({ label: s.code, value: s.value })),

  ]);



  readonly filteredEmployees = computed(() => {

    const rows = this.employees();

    let filtered: Employee[];

    switch (this.filter()) {

      case 'active':

        filtered = rows.filter((e) => e.active);

        break;

      case 'inactive':

        filtered = rows.filter((e) => !e.active);

        break;

      case 'all':

        filtered = rows;

        break;

      default:

        filtered = rows.filter((e) => e.cargoCode === this.filter());

    }

    return sortEmployeesBySeniority(filtered);

  });



  readonly formatDate = formatIsoDate;



  ngOnInit(): void {

    this.loadRoles();

    this.loadShifts();

    this.load();

  }



  loadRoles(): void {

    this.roleService.list(true).subscribe({

      next: (rows) => this.roles.set(rows),

      error: () => {

        this.messages.add({

          severity: 'warn',

          summary: 'Cargos',

          detail: 'Não foi possível carregar cargos ativos.',

        });

      },

    });

  }



  loadShifts(): void {

    this.shiftService.list(true).subscribe({

      next: (rows) => this.shifts.set(rows),

      error: () => {

        this.messages.add({

          severity: 'warn',

          summary: 'Turnos',

          detail: 'Não foi possível carregar turnos.',

        });

      },

    });

  }



  load(): void {

    this.loading.set(true);

    this.employeeService.list().subscribe({

      next: (rows) => {

        this.employees.set(sortEmployeesBySeniority(rows));

        this.loading.set(false);

      },

      error: () => {

        this.loading.set(false);

        this.messages.add({

          severity: 'error',

          summary: 'Erro',

          detail: 'Não foi possível carregar funcionários.',

        });

      },

    });

  }



  dialogTitle(): string {

    return this.dialogMode === 'create' ? 'Novo funcionário' : 'Editar funcionário';

  }



  openNew(): void {

    this.dialogMode = 'create';

    this.editingId = '';

    this.formName = '';

    this.formRoleId = this.cargoOptions()[0]?.value ?? '';

    this.formBirthDate = null;

    this.formSeniorityNumber = null;

    this.formActive = true;

    this.formNoFlightDates = [];

    this.formRestrictedShiftIds = [];

    this.formPrimaryPreferredShiftId = null;

    this.formIsFcf = false;

    this.formFcfSchedule = [];

    this.dialogVisible.set(true);

  }



  openEdit(emp: Employee): void {

    this.dialogMode = 'edit';

    this.editingId = emp.id;

    this.formName = emp.name;

    this.formRoleId = emp.roleId ?? '';

    this.formBirthDate = emp.birthDate ? new Date(`${emp.birthDate}T12:00:00`) : null;

    this.formSeniorityNumber = emp.seniorityNumber ?? null;

    this.formActive = emp.active;

    this.formNoFlightDates = [];

    this.formRestrictedShiftIds = [];

    this.formPrimaryPreferredShiftId = null;

    this.formIsFcf = false;

    this.formFcfSchedule = [];

    this.dialogVisible.set(true);

    this.loadingDetail.set(true);

    this.employeeService.get(emp.id).subscribe({

      next: (detail) => {

        this.formNoFlightDates = (detail.noFlightDates ?? []).map((d) => new Date(`${d}T12:00:00`));

        this.formRestrictedShiftIds = [...(detail.restrictedShiftIds ?? [])];

        this.formPrimaryPreferredShiftId = this.resolvePrimaryPreferredShiftId(

          detail.preferredShiftIds ?? [],

          detail.preferredShifts ?? [],

        );

        this.formIsFcf = detail.isFcf ?? false;

        this.formFcfSchedule = (detail.fcfSchedule ?? []).map((r) => ({
          shiftId: r.shiftId,
          weekday: r.weekday,
        }));

        this.loadingDetail.set(false);

      },

      error: () => {

        this.loadingDetail.set(false);

        this.messages.add({

          severity: 'warn',

          summary: 'Restrições',

          detail: 'Não foi possível carregar restrições do funcionário.',

        });

      },

    });

  }



  onCalendarPeriodChange(period: { year: number; month: number }): void {

    this.calendarViewYear = period.year;

    this.calendarViewMonth = period.month;

  }



  selectFullMonthForNoFlight(): void {

    const days = buildMonthGrid(this.calendarViewYear, this.calendarViewMonth)

      .filter((c) => c.inMonth)

      .map((c) => c.date);

    this.formNoFlightDates = mergeDates(this.formNoFlightDates, days);

  }



  noFlightSummary(): string {

    const n = this.formNoFlightDates.length;

    return n === 0 ? 'Nenhum dia bloqueado para voo' : `${n} dia(s) bloqueado(s) para voo`;

  }



  allShiftsRestricted(): boolean {

    const opts = this.rateioShiftOptions();

    if (opts.length === 0) return false;

    return opts.every((o) => this.formRestrictedShiftIds.includes(o.value));

  }



  restrictedPreferredConflict(): boolean {

    if (!this.formPrimaryPreferredShiftId) return false;

    return this.formRestrictedShiftIds.includes(this.formPrimaryPreferredShiftId);

  }



  isShiftAvoided(shiftId: string): boolean {

    return this.formRestrictedShiftIds.includes(shiftId);

  }



  setShiftAvoided(shiftId: string, avoided: boolean): void {

    if (avoided) {

      if (!this.formRestrictedShiftIds.includes(shiftId)) {

        this.formRestrictedShiftIds = [...this.formRestrictedShiftIds, shiftId];

      }

      if (this.formPrimaryPreferredShiftId === shiftId) {

        this.formPrimaryPreferredShiftId = null;

      }

      return;

    }

    this.formRestrictedShiftIds = this.formRestrictedShiftIds.filter((id) => id !== shiftId);

  }



  resolvePrimaryPreferredShiftId(

    preferredShiftIds: string[],

    preferredShifts: Array<{ id: string; code: string }>,

  ): string | null {

    const rateioIds = new Set(this.rateioShiftOptions().map((s) => s.value));

    for (const id of preferredShiftIds) {

      if (rateioIds.has(id)) return id;

    }

    for (const pref of preferredShifts) {
      const code = asRateioShiftCode(pref.code);
      if (!code) continue;
      const match = this.rateioShiftOptions().find((s) => s.code === code);
      if (match) return match.value;
    }

    return null;
  }

  addFcfScheduleRow(): void {
    const firstShift = this.shiftOptions()[0]?.value;
    if (!firstShift) return;
    const used = new Set(this.formFcfSchedule.map((r) => r.weekday));
    const nextDay = this.fcfWeekdayOptions.find((d) => !used.has(d.value))?.value ?? 1;
    this.formFcfSchedule = [...this.formFcfSchedule, { shiftId: firstShift, weekday: nextDay }];
  }

  removeFcfScheduleRow(index: number): void {
    this.formFcfSchedule = this.formFcfSchedule.filter((_, i) => i !== index);
  }

  onFcfToggle(enabled: boolean): void {
    this.formIsFcf = enabled;
    if (!enabled) {
      this.formFcfSchedule = [];
      return;
    }
    if (this.formFcfSchedule.length === 0) {
      this.addFcfScheduleRow();
    }
  }

  fcfWeekdayLabel(weekday: number): string {
    return this.fcfWeekdayOptions.find((d) => d.value === weekday)?.label ?? String(weekday);
  }



  selectedRoleCode(): string {

    return this.roles().find((r) => r.id === this.formRoleId)?.code ?? 'PAO';

  }



  seniorityHint(): string {

    return this.selectedRoleCode() === 'APAO'

      ? 'Opcional. Ex.: 2 será exibido como 2A'

      : 'Opcional. Se vazio, recebe o próximo número do grupo PAO';

  }



  displaySeniority(emp: Employee): string {

    return emp.seniorityLabel || formatSeniorityLabel(emp);

  }



  formatBirthday(value: string | null | undefined): string {

    return value ? formatIsoDate(value) : '—';

  }



  save(): void {

    const name = this.formName.trim();

    if (!name) {

      this.messages.add({ severity: 'warn', summary: 'Validação', detail: 'Informe o nome.' });

      return;

    }

    if (!this.formRoleId) {

      this.messages.add({ severity: 'warn', summary: 'Validação', detail: 'Selecione o cargo.' });

      return;

    }

    if (this.formIsFcf) {
      const schedule = this.formFcfSchedule.filter((r) => r.shiftId && r.weekday != null);
      if (schedule.length === 0) {
        this.messages.add({
          severity: 'warn',
          summary: 'Validação',
          detail: 'Adicione ao menos uma alocação FCF (dia da semana + turno desejado).',
        });
        return;
      }
      const weekdays = schedule.map((r) => r.weekday);
      if (weekdays.length !== new Set(weekdays).size) {
        this.messages.add({
          severity: 'warn',
          summary: 'Validação',
          detail: 'Cada dia da semana pode aparecer apenas uma vez na alocação FCF.',
        });
        return;
      }
    }



    this.saving.set(true);

    const birthDate = this.formBirthDate ? dateToIso(this.formBirthDate) : null;

    const noFlightDates = [...new Set(this.formNoFlightDates.map((d) => dateToIso(d)))].sort();

    const isFcf = this.formIsFcf;

    const fcfSchedule = isFcf
      ? this.formFcfSchedule.filter((r) => r.shiftId && r.weekday != null)
      : [];



    if (this.dialogMode === 'create') {

      const payload: CreateEmployeePayload = {

        name,

        roleId: this.formRoleId,

        birthDate,

        seniorityNumber: this.formSeniorityNumber ?? undefined,

        active: this.formActive,

        noFlightDates,

        isFcf,

        fcfSchedule,

      };

      this.employeeService.create(payload).subscribe({

        next: () => this.onSaveSuccess('Funcionário cadastrado.'),

        error: (err) => this.onSaveError(err.error?.error ?? 'Falha ao criar funcionário.'),

      });

      return;

    }



    this.employeeService

      .update(this.editingId, {

        name,

        roleId: this.formRoleId,

        birthDate,

        seniorityNumber: this.formSeniorityNumber,

        active: this.formActive,

        noFlightDates,

        isFcf,

        fcfSchedule,

      })

      .subscribe({

        next: () => this.onSaveSuccess('Funcionário atualizado.'),

        error: (err) => this.onSaveError(err.error?.error ?? 'Falha ao atualizar funcionário.'),

      });

  }



  private onSaveSuccess(detail: string): void {

    this.saving.set(false);

    this.dialogVisible.set(false);

    this.messages.add({ severity: 'success', summary: 'Salvo', detail });

    this.load();

  }



  private onSaveError(detail: string): void {

    this.saving.set(false);

    this.messages.add({ severity: 'error', summary: 'Erro', detail });

  }



  toggleActive(emp: Employee): void {

    const next = !emp.active;

    this.employeeService.update(emp.id, { active: next }).subscribe({

      next: () => {

        this.messages.add({

          severity: 'success',

          summary: next ? 'Ativado' : 'Inativado',

          detail: `${emp.name} agora está ${next ? 'ativo' : 'inativo'}.`,

        });

        this.load();

      },

      error: () => {

        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao alterar status.' });

      },

    });

  }



  confirmDelete(emp: Employee): void {

    this.confirm.confirm({

      message: `Tem certeza que deseja excluir ${emp.name}?`,

      header: 'Confirmar exclusão',

      icon: 'pi pi-exclamation-triangle',

      acceptLabel: 'Excluir',

      rejectLabel: 'Cancelar',

      acceptButtonStyleClass: 'p-button-danger',

      accept: () => this.delete(emp),

    });

  }



  private delete(emp: Employee): void {

    this.employeeService.delete(emp.id).subscribe({

      next: () => {

        this.messages.add({ severity: 'success', summary: 'Excluído', detail: 'Funcionário removido.' });

        this.load();

      },

      error: (err) => {

        const body = err.error;

        if (body?.code === 'HAS_OPERATIONAL_HISTORY') {

          this.messages.add({

            severity: 'warn',

            summary: 'Exclusão não permitida',

            detail: body.error ?? 'Funcionário possui histórico. Inative em vez de excluir.',

            life: 8000,

          });

          return;

        }

        this.messages.add({ severity: 'error', summary: 'Erro', detail: body?.error ?? 'Falha ao excluir.' });

      },

    });

  }



  cargoSeverity(code: string): 'warn' | 'info' | 'success' | 'secondary' {

    if (code === 'PAO') return 'warn';

    if (code === 'APAO') return 'info';

    return 'secondary';

  }

}

