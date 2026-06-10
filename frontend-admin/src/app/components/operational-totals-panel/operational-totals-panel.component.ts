import { Component, input } from '@angular/core';
import type { GridAuditTotals } from '../../utils/operational-audit.util';

@Component({
  selector: 'app-operational-totals-panel',
  standalone: true,
  templateUrl: './operational-totals-panel.component.html',
  styleUrl: './operational-totals-panel.component.scss',
})
export class OperationalTotalsPanelComponent {
  readonly totals = input.required<GridAuditTotals>();

  gapDayEntries(): Array<{ day: number; shifts: string[] }> {
    const gaps = this.totals().coverageGapDays ?? {};
    return Object.entries(gaps)
      .map(([day, shifts]) => ({ day: Number(day), shifts }))
      .sort((a, b) => a.day - b.day);
  }
}
