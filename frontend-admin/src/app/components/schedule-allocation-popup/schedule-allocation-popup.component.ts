import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

export type ManualAllocationOption =
  | 'FOLGA'
  | 'FP'
  | 'VOO'
  | 'CURSO'
  | 'SIMULADOR'
  | 'CMA'
  | 'OUTRO'
  | 'ND'
  | 'CLEAR';

export interface AllocationPopupContext {
  employeeName: string;
  startDay: number;
  endDay: number;
}

@Component({
  selector: 'app-schedule-allocation-popup',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule],
  templateUrl: './schedule-allocation-popup.component.html',
  styleUrl: './schedule-allocation-popup.component.scss',
})
export class ScheduleAllocationPopupComponent {
  readonly visible = input(false);
  readonly context = input<AllocationPopupContext | null>(null);

  readonly optionSelected = output<ManualAllocationOption>();
  readonly closed = output<void>();

  readonly options: Array<{ key: ManualAllocationOption; label: string; icon: string }> = [
    { key: 'FOLGA', label: 'Folga', icon: 'pi pi-calendar-minus' },
    { key: 'FP', label: 'Folga Pedida', icon: 'pi pi-calendar-plus' },
    { key: 'VOO', label: 'VOO', icon: 'pi pi-send' },
    { key: 'CURSO', label: 'Curso', icon: 'pi pi-book' },
    { key: 'SIMULADOR', label: 'Simulador', icon: 'pi pi-desktop' },
    { key: 'CMA', label: 'CMA', icon: 'pi pi-id-card' },
    { key: 'OUTRO', label: 'Outro', icon: 'pi pi-tag' },
    { key: 'ND', label: 'ND', icon: 'pi pi-ban' },
    { key: 'CLEAR', label: 'Limpar período', icon: 'pi pi-trash' },
  ];

  title(): string {
    const ctx = this.context();
    if (!ctx) return 'Alocar período';
    if (ctx.startDay === ctx.endDay) {
      return `Dia ${ctx.startDay} — ${ctx.employeeName}`;
    }
    return `Dias ${ctx.startDay}–${ctx.endDay} — ${ctx.employeeName}`;
  }

  pick(option: ManualAllocationOption): void {
    this.optionSelected.emit(option);
  }

  onHide(): void {
    this.closed.emit();
  }
}
