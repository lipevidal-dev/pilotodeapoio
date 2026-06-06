import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { ConfirmationService, MessageService } from 'primeng/api';
import { EmployeeService } from '../../services/employee.service';
import { RoleService } from '../../services/role.service';
import { dateToIso, formatIsoDate } from '../../utils/date-format';
import type { CreateEmployeePayload, Employee, JobRole } from '../../models/api.models';

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
    SelectModule,
    SelectButtonModule,
    CheckboxModule,
    DatePickerModule,
  ],
  templateUrl: './employees.component.html',
  styleUrl: './employees.component.scss',
})
export class EmployeesComponent implements OnInit {
  private readonly employeeService = inject(EmployeeService);
  private readonly roleService = inject(RoleService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly employees = signal<Employee[]>([]);
  readonly roles = signal<JobRole[]>([]);
  readonly loading = signal(false);
  readonly dialogVisible = signal(false);
  readonly saving = signal(false);

  dialogMode: DialogMode = 'create';
  editingId = '';
  formName = '';
  formRoleId = '';
  formBirthDate: Date | null = null;
  formActive = true;
  filter: EmployeeFilter = 'all';

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

  readonly filteredEmployees = computed(() => {
    const rows = this.employees();
    switch (this.filter) {
      case 'active':
        return rows.filter((e) => e.active);
      case 'inactive':
        return rows.filter((e) => !e.active);
      case 'all':
        return rows;
      default:
        return rows.filter((e) => e.cargoCode === this.filter);
    }
  });

  readonly formatDate = formatIsoDate;

  ngOnInit(): void {
    this.loadRoles();
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

  load(): void {
    this.loading.set(true);
    this.employeeService.list().subscribe({
      next: (rows) => {
        this.employees.set(rows);
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
    this.formActive = true;
    this.dialogVisible.set(true);
  }

  openEdit(emp: Employee): void {
    this.dialogMode = 'edit';
    this.editingId = emp.id;
    this.formName = emp.name;
    this.formRoleId = emp.roleId ?? '';
    this.formBirthDate = emp.birthDate ? new Date(`${emp.birthDate}T12:00:00`) : null;
    this.formActive = emp.active;
    this.dialogVisible.set(true);
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

    this.saving.set(true);

    const birthDate = this.formBirthDate ? dateToIso(this.formBirthDate) : null;

    if (this.dialogMode === 'create') {
      const payload: CreateEmployeePayload = {
        name,
        roleId: this.formRoleId,
        birthDate,
        active: this.formActive,
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
        active: this.formActive,
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
