import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmationService, MessageService } from 'primeng/api';
import { RoleService } from '../../../services/role.service';
import type { CreateJobRolePayload, JobRole } from '../../../models/api.models';

type RoleFilter = 'all' | 'active' | 'inactive';
type DialogMode = 'create' | 'edit';

@Component({
  selector: 'app-roles',
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
    TextareaModule,
    SelectButtonModule,
    CheckboxModule,
    InputNumberModule,
  ],
  templateUrl: './roles.component.html',
  styleUrl: './roles.component.scss',
})
export class RolesComponent implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly roles = signal<JobRole[]>([]);
  readonly loading = signal(false);
  readonly dialogVisible = signal(false);
  readonly saving = signal(false);

  dialogMode: DialogMode = 'create';
  editingId = '';
  formCode = '';
  formName = '';
  formDescription = '';
  formActive = true;
  formDisplayOrder = 0;
  filter = signal<RoleFilter>('all');

  readonly filterOptions = [
    { label: 'Todos', value: 'all' as const },
    { label: 'Ativos', value: 'active' as const },
    { label: 'Inativos', value: 'inactive' as const },
  ];

  readonly filteredRoles = computed(() => {
    const rows = this.roles();
    switch (this.filter()) {
      case 'active':
        return rows.filter((r) => r.active);
      case 'inactive':
        return rows.filter((r) => !r.active);
      default:
        return rows;
    }
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.roleService.list().subscribe({
      next: (rows) => {
        this.roles.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: 'Não foi possível carregar cargos.',
        });
      },
    });
  }

  dialogTitle(): string {
    return this.dialogMode === 'create' ? 'Novo cargo' : 'Editar cargo';
  }

  openNew(): void {
    this.dialogMode = 'create';
    this.editingId = '';
    this.formCode = '';
    this.formName = '';
    this.formDescription = '';
    this.formActive = true;
    this.formDisplayOrder = 0;
    this.dialogVisible.set(true);
  }

  openEdit(role: JobRole): void {
    this.dialogMode = 'edit';
    this.editingId = role.id;
    this.formCode = role.code;
    this.formName = role.name;
    this.formDescription = role.description ?? '';
    this.formActive = role.active;
    this.formDisplayOrder = role.displayOrder;
    this.dialogVisible.set(true);
  }

  save(): void {
    const code = this.formCode.trim().toUpperCase();
    const name = this.formName.trim();
    if (!code || !name) {
      this.messages.add({ severity: 'warn', summary: 'Validação', detail: 'Informe código e nome.' });
      return;
    }

    this.saving.set(true);

    if (this.dialogMode === 'create') {
      const payload: CreateJobRolePayload = {
        code,
        name,
        description: this.formDescription.trim() || null,
        active: this.formActive,
        displayOrder: this.formDisplayOrder,
      };
      this.roleService.create(payload).subscribe({
        next: () => this.onSaveSuccess('Cargo cadastrado.'),
        error: (err) => this.onSaveError(err.error?.error ?? 'Falha ao criar cargo.'),
      });
      return;
    }

    this.roleService
      .update(this.editingId, {
        code,
        name,
        description: this.formDescription.trim() || null,
        active: this.formActive,
        displayOrder: this.formDisplayOrder,
      })
      .subscribe({
        next: () => this.onSaveSuccess('Cargo atualizado.'),
        error: (err) => this.onSaveError(err.error?.error ?? 'Falha ao atualizar cargo.'),
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

  toggleActive(role: JobRole): void {
    const next = !role.active;
    this.roleService.update(role.id, { active: next }).subscribe({
      next: () => {
        this.messages.add({
          severity: 'success',
          summary: next ? 'Ativado' : 'Inativado',
          detail: `${role.code} agora está ${next ? 'ativo' : 'inativo'}.`,
        });
        this.load();
      },
      error: () => {
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao alterar status.' });
      },
    });
  }

  confirmDelete(role: JobRole): void {
    this.confirm.confirm({
      message: `Tem certeza que deseja excluir o cargo ${role.code}?`,
      header: 'Confirmar exclusão',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Excluir',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.delete(role),
    });
  }

  private delete(role: JobRole): void {
    this.roleService.delete(role.id).subscribe({
      next: () => {
        this.messages.add({ severity: 'success', summary: 'Excluído', detail: 'Cargo removido.' });
        this.load();
      },
      error: (err) => {
        const body = err.error;
        if (body?.code === 'ROLE_IN_USE') {
          this.messages.add({
            severity: 'warn',
            summary: 'Exclusão não permitida',
            detail: body.error ?? 'Existem funcionários vinculados a este cargo.',
            life: 8000,
          });
          return;
        }
        this.messages.add({ severity: 'error', summary: 'Erro', detail: body?.error ?? 'Falha ao excluir.' });
      },
    });
  }
}
