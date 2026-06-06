import { Component, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ScheduleCellComponent } from '../schedule-cell/schedule-cell.component';
import { EmployeeSummaryComponent } from '../employee-summary/employee-summary.component';
import { OperationalTotalsPanelComponent } from '../operational-totals-panel/operational-totals-panel.component';
import type { ScheduleGridData } from '../../models/schedule-grid.models';
import type { GridAuditTotals } from '../../utils/operational-audit.util';

@Component({
  selector: 'app-schedule-grid',
  standalone: true,
  imports: [
    ScheduleCellComponent,
    EmployeeSummaryComponent,
    OperationalTotalsPanelComponent,
    ButtonModule,
  ],
  templateUrl: './schedule-grid.component.html',
  styleUrl: './schedule-grid.component.scss',
})
export class ScheduleGridComponent {
  readonly grid = input.required<ScheduleGridData>();
  readonly auditTotals = input<GridAuditTotals | null>(null);

  readonly summaryVisible = signal(true);

  readonly summaryFields = [
    'turnos',
    'diasTrabalhados',
    'folgas',
    'folgaSocial',
    'fp',
    'fani',
    'ferias',
    'vooDisp',
    'maxConsec',
    'status',
  ] as const;

  readonly summaryColCount = this.summaryFields.length;

  toggleSummary(): void {
    this.summaryVisible.update((v) => !v);
  }

  summaryToggleLabel(): string {
    return this.summaryVisible() ? 'Ocultar resumo' : 'Mostrar resumo';
  }

  isWeekend(index: number): boolean {
    const label = this.grid().weekdayLabels[index];
    return label === 'Dom' || label === 'Sáb';
  }
}
