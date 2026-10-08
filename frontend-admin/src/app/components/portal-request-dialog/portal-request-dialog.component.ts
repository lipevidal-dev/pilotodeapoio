import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import type { PortalRequestType } from '../../models/api.models';

export interface PortalRequestDialogContext {
  day: number;
  days?: number[];
  dateIso: string;
  employeeName: string;
  pendingRequest?: {
    type: PortalRequestType;
    label: string;
    requestId?: string;
  };
}

interface RequestOption {
  type: PortalRequestType;
  label: string;
  icon: string;
}

const PAO_OPTIONS: RequestOption[] = [
  { type: 'FP', label: 'Folga pedida (FP)', icon: 'pi pi-calendar-minus' },
  { type: 'FERIAS', label: 'Férias', icon: 'pi pi-sun' },
  { type: 'OUTRO', label: 'Outro', icon: 'pi pi-ellipsis-h' },
];

const APAO_OPTIONS: RequestOption[] = [
  { type: 'FP', label: 'Folga pedida', icon: 'pi pi-calendar-minus' },
  { type: 'FERIAS', label: 'Férias', icon: 'pi pi-sun' },
  { type: 'FA', label: 'Folga agrupada', icon: 'pi pi-calendar' },
  { type: 'TURNO', label: 'Turno', icon: 'pi pi-clock' },
  { type: 'OUTRO', label: 'Outro', icon: 'pi pi-ellipsis-h' },
];

@Component({
  selector: 'app-portal-request-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, TextareaModule],
  templateUrl: './portal-request-dialog.component.html',
  styleUrl: './portal-request-dialog.component.scss',
})
export class PortalRequestDialogComponent {
  readonly visible = input(false);
  readonly context = input<PortalRequestDialogContext | null>(null);
  readonly employeeType = input('PAO');
  readonly submitting = input(false);
  readonly mobile = input(false);

  readonly visibleChange = output<boolean>();
  readonly requestSubmit = output<{ type: PortalRequestType; notes?: string }>();
  readonly requestCancel = output<{ type: PortalRequestType; requestId?: string }>();

  readonly selectedType = signal<PortalRequestType | null>(null);
  readonly notes = signal('');

  readonly requestOptions = computed(() =>
    String(this.employeeType() ?? 'PAO').toUpperCase().includes('APAO') ? APAO_OPTIONS : PAO_OPTIONS,
  );

  readonly canConfirm = computed(() => {
    const type = this.selectedType();
    if (!type) return false;
    if (type !== 'FA') return true;
    const ctx = this.context();
    if (!ctx) return false;
    const days = [...this.selectedDays(ctx)].sort((a, b) => a - b);
    return days.length === 2 && days[1] === days[0]! + 1;
  });

  readonly faHint = computed(() =>
    this.selectedType() !== 'FA' || this.canConfirm()
      ? null
      : 'Folga agrupada exige selecionar exatamente 2 dias consecutivos.',
  );

  readonly dialogStyle = computed(() =>
    this.mobile() ? { width: 'min(100vw - 1.5rem, 26rem)' } : { width: '26rem' },
  );

  onHide(): void {
    this.visibleChange.emit(false);
    this.selectedType.set(null);
    this.notes.set('');
  }

  pick(type: PortalRequestType): void {
    this.selectedType.set(type);
  }

  confirm(): void {
    const type = this.selectedType();
    if (!type || !this.canConfirm()) return;
    const notes = this.notes().trim();
    this.requestSubmit.emit(notes ? { type, notes } : { type });
  }

  cancelPending(): void {
    const pending = this.context()?.pendingRequest;
    if (!pending) return;
    this.requestCancel.emit({ type: pending.type, requestId: pending.requestId });
  }

  isCancelMode(): boolean {
    return !!this.context()?.pendingRequest;
  }

  dialogTitle(): string {
    const ctx = this.context();
    if (!ctx) return 'Solicitar dia';
    const days = this.selectedDays(ctx);
    if (days.length > 1) return `${days.length} dias — ${ctx.employeeName}`;
    return `Dia ${String(ctx.day).padStart(2, '0')} — ${ctx.employeeName}`;
  }

  dateLabel(): string {
    const ctx = this.context();
    if (!ctx) return '';
    const days = this.selectedDays(ctx);
    if (days.length === 1) return ctx.dateIso;
    return days.map((day) => String(day).padStart(2, '0')).join(', ');
  }

  private selectedDays(ctx: PortalRequestDialogContext): number[] {
    return ctx.days?.length ? [...ctx.days].sort((a, b) => a - b) : [ctx.day];
  }
}
