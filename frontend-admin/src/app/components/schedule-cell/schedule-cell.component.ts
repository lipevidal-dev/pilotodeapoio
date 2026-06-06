import { Component, input } from '@angular/core';
import { cellKindClass } from '../../utils/schedule-cell.mapper';
import type { ScheduleCellData } from '../../models/schedule-grid.models';

@Component({
  selector: 'app-schedule-cell',
  standalone: true,
  templateUrl: './schedule-cell.component.html',
  styleUrl: './schedule-cell.component.scss',
})
export class ScheduleCellComponent {
  readonly cell = input.required<ScheduleCellData>();

  cssClass(): string {
    return cellKindClass(this.cell().kind);
  }
}
