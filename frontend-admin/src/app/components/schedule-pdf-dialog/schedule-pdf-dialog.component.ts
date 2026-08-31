import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import {
  SCHEDULE_PDF_SCOPE_OPTIONS,
  type SchedulePdfScope,
} from '../../utils/schedule-pdf-scope.util';

@Component({
  selector: 'app-schedule-pdf-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule],
  templateUrl: './schedule-pdf-dialog.component.html',
  styleUrl: './schedule-pdf-dialog.component.scss',
})
export class SchedulePdfDialogComponent {
  readonly visible = input(false);
  readonly submitting = input(false);
  readonly mobile = input(false);
  /** Se false, oculta a opção "apenas do meu usuário". */
  readonly showMineOption = input(true);

  readonly visibleChange = output<boolean>();
  readonly confirm = output<SchedulePdfScope>();
  readonly excelConfirm = output<SchedulePdfScope>();

  readonly selected = signal<SchedulePdfScope>('all');

  readonly options = computed(() => {
    const all = SCHEDULE_PDF_SCOPE_OPTIONS;
    return this.showMineOption() ? all : all.filter((o) => o.value !== 'mine');
  });

  onHide(): void {
    this.visibleChange.emit(false);
  }

  select(scope: SchedulePdfScope): void {
    this.selected.set(scope);
  }

  onConfirm(): void {
    this.confirm.emit(this.selected());
  }

  onExcelConfirm(): void {
    this.excelConfirm.emit(this.selected());
  }
}
