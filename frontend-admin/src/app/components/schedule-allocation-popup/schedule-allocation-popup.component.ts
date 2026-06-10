import { Component, computed, effect, input, output, signal } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';

import { DialogModule } from 'primeng/dialog';

import { SelectModule } from 'primeng/select';

import type { EmployeeType, ManualAllocationType, Shift } from '../../models/api.models';

import { buildManualAllocationOptions } from '../../utils/build-manual-allocation-options.util';



export type ManualAllocationOption = ManualAllocationType;



export interface AllocationPopupContext {

  employeeName: string;

  employeeType: EmployeeType;

  startDay: number;

  endDay: number;

  /** Dias selecionados (Ctrl+clique); quando presente, pode haver intervalos não contíguos. */

  selectedDays?: number[];

}



@Component({

  selector: 'app-schedule-allocation-popup',

  standalone: true,

  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, SelectModule],

  templateUrl: './schedule-allocation-popup.component.html',

  styleUrl: './schedule-allocation-popup.component.scss',

})

export class ScheduleAllocationPopupComponent {

  readonly visible = input(false);

  readonly context = input<AllocationPopupContext | null>(null);

  readonly year = input(2026);

  readonly month = input(1);

  readonly shifts = input<Shift[]>([]);



  readonly optionSelected = output<ManualAllocationOption>();

  readonly closed = output<void>();



  readonly dialogVisible = signal(false);

  readonly selectedOption = signal<ManualAllocationOption | null>(null);

  readonly selectOptions = computed(() => {
    const ctx = this.context();
    const employeeType = ctx?.employeeType ?? 'PAO';
    return buildManualAllocationOptions(this.shifts(), employeeType);
  });



  constructor() {

    effect(() => {

      this.dialogVisible.set(this.visible());

      if (this.visible()) {

        this.selectedOption.set(null);

      }

    });

  }



  subtitle(): string {

    const ctx = this.context();

    if (!ctx) return '';

    const pad = (n: number) => String(n).padStart(2, '0');

    const monthStr = pad(this.month());

    if (ctx.selectedDays && ctx.selectedDays.length > 1) {

      const sorted = [...ctx.selectedDays].sort((a, b) => a - b);

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



  onDialogHide(): void {

    this.dialogVisible.set(false);

    this.closed.emit();

  }



  cancel(): void {

    this.onDialogHide();

  }



  apply(): void {

    const option = this.selectedOption();

    if (!option) return;

    this.optionSelected.emit(option);

  }

}


