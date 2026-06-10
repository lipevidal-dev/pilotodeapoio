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
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ShiftService } from '../../../services/shift.service';
import { formatIsoDate } from '../../../utils/date-format';
import type { CreateShiftPayload, Shift, ShiftRoleType } from '../../../models/api.models';

type ShiftFilter = 'all' | 'active' | 'inactive' | 'PAO' | 'APAO' | 'BOTH';
type DialogMode = 'create' | 'edit';

@Component({
  selector: 'app-shifts',
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
    InputNumberModule,
  ],
  templateUrl: './shifts.component.html',
  styleUrl: './shifts.component.scss',
})
export class ShiftsComponent implements OnInit {
  private readonly shiftService = inject(ShiftService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly shifts = signal<Shift[]>([]);
  readonly loading = signal(false);
  readonly dialogVisible = signal(false);
  readonly saving = signal(false);

  dialogMode: DialogMode = 'create';
  editingId = '';
  formCode = '';
  formName = '';
  formStartTime = '06:00';
  formEndTime = '14:00';
  formRoleType: ShiftRoleType = 'PAO';
  formActive = true;
  formDisplayOrder = 0;
  formMandatoryCoverage = false;
  formRequiresT8PairNd = false;
  formCoverageType: 'REQUIRED' | 'PARALLEL' = 'REQUIRED';
  filter = signal<ShiftFilter>('all');

  readonly coverageTypeOptions = [
    { label: 'Cobertura obrigatória', value: 'REQUIRED' as const },
    { label: 'Especial/paralelo', value: 'PARALLEL' as const },
  ];

  readonly roleOptions = [
    { label: 'PAO', value: 'PAO' as ShiftRoleType },
    { label: 'APAO', value: 'APAO' as ShiftRoleType },
    { label: 'Ambos', value: 'BOTH' as ShiftRoleType },
  ];

  readonly filterOptions = [
    { label: 'Todos', value: 'all' as const },
    { label: 'Ativos', value: 'active' as const },
    { label: 'Inativos', value: 'inactive' as const },
    { label: 'PAO', value: 'PAO' as const },
    { label: 'APAO', value: 'APAO' as const },
    { label: 'Ambos', value: 'BOTH' as const },
  ];

  readonly filteredShifts = computed(() => {
    const rows = this.shifts();
    switch (this.filter()) {
      case 'active':
        return rows.filter((s) => s.active);
      case 'inactive':
        return rows.filter((s) => !s.active);
      case 'PAO':
        return rows.filter((s) => s.roleType === 'PAO');
      case 'APAO':
        return rows.filter((s) => s.roleType === 'APAO');
      case 'BOTH':
        return rows.filter((s) => s.roleType === 'BOTH');
      default:
        return rows;
    }
  });

  readonly formatDate = formatIsoDate;

  coverageTypeLabel(type: 'REQUIRED' | 'PARALLEL' | undefined): string {
    return type === 'PARALLEL' ? 'Especial/paralelo' : 'Cobertura obrigatória';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.shiftService.list().subscribe({
      next: (rows) => {
        this.shifts.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: 'Não foi possível carregar turnos.',
        });
      },
    });
  }

  dialogTitle(): string {
    return this.dialogMode === 'create' ? 'Novo turno' : 'Editar turno';
  }

  openNew(): void {
    this.dialogMode = 'create';
    this.editingId = '';
    this.formCode = '';
    this.formName = '';
    this.formStartTime = '06:00';
    this.formEndTime = '14:00';
    this.formRoleType = 'PAO';
    this.formActive = true;
    this.formDisplayOrder = 0;
    this.formMandatoryCoverage = false;
    this.formRequiresT8PairNd = false;
    this.formCoverageType = 'REQUIRED';
    this.dialogVisible.set(true);
  }

  openEdit(shift: Shift): void {
    this.dialogMode = 'edit';
    this.editingId = shift.id;
    this.formCode = shift.code;
    this.formName = shift.name;
    this.formStartTime = shift.startTime;
    this.formEndTime = shift.endTime;
    this.formRoleType = shift.roleType;
    this.formActive = shift.active;
    this.formDisplayOrder = shift.displayOrder;
    this.formMandatoryCoverage = shift.mandatoryCoverage;
    this.formRequiresT8PairNd = shift.requiresT8PairNd;
    this.formCoverageType = shift.coverageType ?? 'REQUIRED';
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
      const payload: CreateShiftPayload = {
        code,
        name,
        startTime: this.formStartTime,
        endTime: this.formEndTime,
        roleType: this.formRoleType,
        active: this.formActive,
        displayOrder: this.formDisplayOrder,
        mandatoryCoverage: this.formCoverageType === 'REQUIRED' ? this.formMandatoryCoverage : false,
        requiresT8PairNd: this.formRequiresT8PairNd,
        coverageType: this.formCoverageType,
      };
      this.shiftService.create(payload).subscribe({
        next: () => this.onSaveSuccess('Turno cadastrado.'),
        error: (err) => this.onSaveError(err.error?.error ?? 'Falha ao criar turno.'),
      });
      return;
    }

    this.shiftService
      .update(this.editingId, {
        code,
        name,
        startTime: this.formStartTime,
        endTime: this.formEndTime,
        roleType: this.formRoleType,
        active: this.formActive,
        displayOrder: this.formDisplayOrder,
        mandatoryCoverage: this.formCoverageType === 'REQUIRED' ? this.formMandatoryCoverage : false,
        requiresT8PairNd: this.formRequiresT8PairNd,
        coverageType: this.formCoverageType,
      })
      .subscribe({
        next: () => this.onSaveSuccess('Turno atualizado.'),
        error: (err) => this.onSaveError(err.error?.error ?? 'Falha ao atualizar turno.'),
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

  toggleActive(shift: Shift): void {
    const next = !shift.active;
    this.shiftService.update(shift.id, { active: next }).subscribe({
      next: () => {
        this.messages.add({
          severity: 'success',
          summary: next ? 'Ativado' : 'Inativado',
          detail: `${shift.code} agora está ${next ? 'ativo' : 'inativo'}.`,
        });
        this.load();
      },
      error: () => {
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Falha ao alterar status.' });
      },
    });
  }

  confirmDelete(shift: Shift): void {
    this.confirm.confirm({
      message: `Tem certeza que deseja excluir o turno ${shift.code}?`,
      header: 'Confirmar exclusão',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Excluir',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.delete(shift),
    });
  }

  private delete(shift: Shift): void {
    this.shiftService.delete(shift.id).subscribe({
      next: () => {
        this.messages.add({ severity: 'success', summary: 'Excluído', detail: 'Turno removido.' });
        this.load();
      },
      error: (err) => {
        const body = err.error;
        if (body?.code === 'SHIFT_HAS_OPERATIONAL_HISTORY') {
          this.messages.add({
            severity: 'warn',
            summary: 'Exclusão não permitida',
            detail: body.error ?? 'Turno possui histórico. Inative em vez de excluir.',
            life: 8000,
          });
          return;
        }
        this.messages.add({ severity: 'error', summary: 'Erro', detail: body?.error ?? 'Falha ao excluir.' });
      },
    });
  }
}
