import {
  Component,
  HostListener,
  input,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ScheduleCellComponent } from '../schedule-cell/schedule-cell.component';
import { EmployeeSummaryComponent } from '../employee-summary/employee-summary.component';
import { OperationalTotalsPanelComponent } from '../operational-totals-panel/operational-totals-panel.component';
import type { ScheduleGridData } from '../../models/schedule-grid.models';
import type { GridAuditTotals } from '../../utils/operational-audit.util';
import {
  buildHorizontalSelection,
  selectionKey,
  type GridCellCoordinate,
} from '../../utils/schedule-grid-selection.util';

export interface GridSelectionComplete {
  employeeId: string;
  employeeName: string;
  startDay: number;
  endDay: number;
}

export interface GridMoveRequest {
  source: { employeeId: string; day: number };
  target: { employeeId: string; day: number };
}

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
  readonly editable = input(false);

  readonly selectionCompleted = output<GridSelectionComplete>();
  readonly moveRequested = output<GridMoveRequest>();

  readonly summaryVisible = signal(true);

  private dragAnchor: GridCellCoordinate | null = null;
  private isSelecting = false;
  private dragSource: GridCellCoordinate | null = null;

  readonly previewSelection = signal<Set<string>>(new Set());
  readonly selectedCells = signal<Set<string>>(new Set());
  readonly dragOverKey = signal<string | null>(null);
  readonly draggingKey = signal<string | null>(null);

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

  employeeName(employeeId: string): string {
    for (const group of this.grid().groups) {
      const row = group.rows.find((r) => r.employeeId === employeeId);
      if (row) return row.name;
    }
    return employeeId;
  }

  onCellMouseDown(event: MouseEvent, employeeId: string, day: number): void {
    if (!this.editable() || event.button !== 0) return;
    event.preventDefault();
    this.isSelecting = true;
    this.dragAnchor = { employeeId, day };
    const cells = buildHorizontalSelection(this.dragAnchor, this.dragAnchor);
    this.previewSelection.set(new Set(cells.map(selectionKey)));
  }

  onCellMouseEnter(employeeId: string, day: number): void {
    if (!this.editable() || !this.isSelecting || !this.dragAnchor) return;
    const cells = buildHorizontalSelection(this.dragAnchor, { employeeId, day });
    this.previewSelection.set(new Set(cells.map(selectionKey)));
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    if (!this.isSelecting) return;
    this.isSelecting = false;
    const keys = [...this.previewSelection()];
    this.previewSelection.set(new Set());
    if (keys.length === 0 || !this.dragAnchor) return;

    const days = keys
      .map((k) => Number(k.split('|')[1]))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    const startDay = days[0]!;
    const endDay = days[days.length - 1]!;
    this.selectedCells.set(new Set(keys));

    this.selectionCompleted.emit({
      employeeId: this.dragAnchor.employeeId,
      employeeName: this.employeeName(this.dragAnchor.employeeId),
      startDay,
      endDay,
    });
    this.dragAnchor = null;
  }

  clearSelection(): void {
    this.selectedCells.set(new Set());
    this.previewSelection.set(new Set());
  }

  isCellHighlighted(employeeId: string, day: number): boolean {
    const key = selectionKey({ employeeId, day });
    return this.selectedCells().has(key) || this.previewSelection().has(key);
  }

  isDragOver(employeeId: string, day: number): boolean {
    return this.dragOverKey() === selectionKey({ employeeId, day });
  }

  isDragging(employeeId: string, day: number): boolean {
    return this.draggingKey() === selectionKey({ employeeId, day });
  }

  onDragStart(event: DragEvent, employeeId: string, day: number): void {
    if (!this.editable()) return;
    const key = selectionKey({ employeeId, day });
    this.dragSource = { employeeId, day };
    this.draggingKey.set(key);
    event.dataTransfer?.setData('text/plain', key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragEnd(): void {
    this.draggingKey.set(null);
    this.dragOverKey.set(null);
    this.dragSource = null;
  }

  onDragOver(event: DragEvent, employeeId: string, day: number): void {
    if (!this.editable() || !this.dragSource) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverKey.set(selectionKey({ employeeId, day }));
  }

  onDragLeave(employeeId: string, day: number): void {
    const key = selectionKey({ employeeId, day });
    if (this.dragOverKey() === key) this.dragOverKey.set(null);
  }

  onDrop(event: DragEvent, employeeId: string, day: number): void {
    if (!this.editable() || !this.dragSource) return;
    event.preventDefault();
    const source = this.dragSource;
    this.dragSource = null;
    this.draggingKey.set(null);
    this.dragOverKey.set(null);
    if (source.employeeId === employeeId && source.day === day) return;
    this.moveRequested.emit({
      source,
      target: { employeeId, day },
    });
  }
}
