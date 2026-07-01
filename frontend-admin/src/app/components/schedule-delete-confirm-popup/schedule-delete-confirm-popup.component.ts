import { Component, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { CheckboxModule } from 'primeng/checkbox';
import type { ScheduleCellKind } from '../../models/schedule-grid.models';

export interface DeletePopupCell {
  day: number;
  display: string;
  kind: ScheduleCellKind;
  folgaBaseKind?: ScheduleCellKind;
}

export interface DeletePopupContext {
  employeeName: string;
  startDay: number;
  endDay: number;
  days: number[];
  cells: DeletePopupCell[];
}

@Component({
  selector: 'app-schedule-delete-confirm-popup',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, CheckboxModule],
  templateUrl: './schedule-delete-confirm-popup.component.html',
  styleUrl: './schedule-delete-confirm-popup.component.scss',
})
export class ScheduleDeleteConfirmPopupComponent {
  readonly visible = input(false);
  readonly context = input<DeletePopupContext | null>(null);
  readonly year = input(2026);
  readonly month = input(1);

  readonly confirmed = output<{ force: boolean }>();
  readonly closed = output<void>();

  readonly dialogVisible = signal(false);
  readonly forceDelete = signal(false);

  readonly hasProtectedCells = computed(() => {
    const ctx = this.context();
    if (!ctx) return false;
    return ctx.cells.some(
      (c) =>
        c.kind === 'fp' ||
        c.kind === 'fp-weekend' ||
        c.folgaBaseKind === 'fp' ||
        c.kind === 'nd' ||
        c.kind === 't8',
    );
  });

  readonly canConfirmDelete = computed(() => {
    if (!this.hasProtectedCells()) return true;
    return this.forceDelete();
  });

  constructor() {
    effect(() => {
      this.dialogVisible.set(this.visible());
      if (this.visible()) {
        this.forceDelete.set(false);
      }
    });
  }

  subtitle(): string {
    const ctx = this.context();
    if (!ctx) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthStr = pad(this.month());
    if (ctx.days.length > 1) {
      const sorted = [...ctx.days].sort((a, b) => a - b);
      const isContiguous =
        sorted.length === ctx.endDay - ctx.startDay + 1 &&
        sorted[0] === ctx.startDay &&
        sorted[sorted.length - 1] === ctx.endDay;
      if (!isContiguous) {
        const labels = sorted.map((d) => pad(d)).join(', ');
        return `${ctx.employeeName} • dias ${labels}/${monthStr}`;
      }
    }
    if (ctx.startDay === ctx.endDay) {
      return `${ctx.employeeName} • ${pad(ctx.startDay)}/${monthStr}`;
    }
    return `${ctx.employeeName} • ${pad(ctx.startDay)}/${monthStr} até ${pad(ctx.endDay)}/${monthStr}`;
  }

  cellSummary(): string {
    const ctx = this.context();
    if (!ctx) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return [...ctx.cells]
      .sort((a, b) => a.day - b.day)
      .map((c) => `${pad(c.day)}: ${c.display || '—'}`)
      .join(' · ');
  }

  onDialogHide(): void {
    this.dialogVisible.set(false);
    this.closed.emit();
  }

  cancel(): void {
    this.onDialogHide();
  }

  confirm(): void {
    this.confirmed.emit({ force: this.forceDelete() });
  }
}
