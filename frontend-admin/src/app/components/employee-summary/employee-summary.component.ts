import { Component, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { EmployeeSummaryStats } from '../../models/schedule-grid.models';
import { statusDetailTooltip, turnosTooltip } from '../../utils/operational-audit.util';

export type SummaryField =
  | 'turnos'
  | 'diasTrabalhados'
  | 'folgas'
  | 'folgaSocial'
  | 'fp'
  | 'fani'
  | 'ferias'
  | 'vooDisp'
  | 'maxConsec'
  | 'status';

@Component({
  selector: 'app-employee-summary',
  standalone: true,
  imports: [TooltipModule],
  templateUrl: './employee-summary.component.html',
  styleUrl: './employee-summary.component.scss',
})
export class EmployeeSummaryComponent {
  readonly summary = input.required<EmployeeSummaryStats>();
  readonly field = input<SummaryField | null>(null);

  turnosDetail(): string {
    return turnosTooltip(this.summary());
  }

  statusDetail(): string {
    return statusDetailTooltip(this.summary());
  }

  displayValue(): string | number {
    const s = this.summary();
    const f = this.field();
    if (!f) return 0;
    if (f === 'folgaSocial') {
      if (s.fa > 0) return s.fa;
      return s.folgaSocialOk ? 'Sim' : 'Não';
    }
    if (f === 'status') return s.status;
    if (f === 'vooDisp') return s.vooDisp;
    return s[f];
  }

  statusClass(): string {
    const st = this.summary().status;
    if (st === 'OK') return 'status-ok';
    if (st === 'ATENÇÃO') return 'status-warn';
    return 'status-crit';
  }
}
