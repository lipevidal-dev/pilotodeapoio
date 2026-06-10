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
import type { EmployeeType } from '../../models/api.models';
import type { ScheduleCellData, ScheduleCellKind, ScheduleGridData } from '../../models/schedule-grid.models';
import type { GridAuditTotals } from '../../utils/operational-audit.util';
import {
  isDeletableCell,
  isDraggableCell,
  isSelectableCell,
} from '../../utils/schedule-grid-cell.util';
import {
  buildHorizontalSelection,
  selectionKey,
  type GridCellCoordinate,
} from '../../utils/schedule-grid-selection.util';

export interface GridSelectionComplete {
  employeeId: string;
  employeeName: string;
  employeeType: EmployeeType;
  startDay: number;
  endDay: number;
  /** Dias selecionados com Ctrl+clique (podem ser não contíguos). */
  days?: number[];
}

export interface GridMoveRequest {
  source: { employeeId: string; day: number };
  target: { employeeId: string; day: number };
}

export interface GridDeletionCell {
  day: number;
  display: string;
  kind: ScheduleCellKind;
}

export interface GridDeletionSelectionComplete {
  employeeId: string;
  employeeName: string;
  startDay: number;
  endDay: number;
  days: number[];
  cells: GridDeletionCell[];
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
  readonly deletionSelectionCompleted = output<GridDeletionSelectionComplete>();
  readonly moveRequested = output<GridMoveRequest>();

  readonly summaryVisible = signal(true);

  private dragAnchor: GridCellCoordinate | null = null;
  private isSelecting = false;
  private dragSource: GridCellCoordinate | null = null;
  private dragActive = false;
  private ctrlMultiActive = false;
  private ctrlMultiEmployeeId: string | null = null;
  private shiftDeleteMultiActive = false;
  private shiftDeleteEmployeeId: string | null = null;

  readonly previewSelection = signal<Set<string>>(new Set());
  readonly selectedCells = signal<Set<string>>(new Set());
  readonly deleteSelectedCells = signal<Set<string>>(new Set());
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

  readonly isSelectableCell = isSelectableCell;
  readonly isDraggableCell = isDraggableCell;
  readonly isDeletableCell = isDeletableCell;

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

  hasCoverageGap(day: number): boolean {
    return (this.auditTotals()?.coverageGapDays?.[day]?.length ?? 0) > 0;
  }

  hasAnyCoverageGap(): boolean {
    const gaps = this.auditTotals()?.coverageGapDays;
    if (!gaps) return false;
    return Object.keys(gaps).length > 0;
  }

  coverageGapTooltip(day: number): string {
    const missing = this.auditTotals()?.coverageGapDays?.[day] ?? [];
    if (missing.length === 0) return '';
    return `Falta cobertura PAO: ${missing.join(', ')}`;
  }

  employeeName(employeeId: string): string {
    return this.employeeRow(employeeId)?.name ?? employeeId;
  }

  employeeType(employeeId: string): EmployeeType {
    for (const group of this.grid().groups) {
      const row = group.rows.find((r) => r.employeeId === employeeId);
      if (row) {
        const normalized = String(row.type ?? '').trim().toUpperCase();
        if (normalized === 'PAO' || normalized === 'APAO') return normalized;
        return group.type === 'PAO' ? 'PAO' : 'APAO';
      }
    }
    return 'PAO';
  }

  private employeeRow(employeeId: string) {
    for (const group of this.grid().groups) {
      const row = group.rows.find((r) => r.employeeId === employeeId);
      if (row) return row;
    }
    return undefined;
  }

  /** Modo 1a — Shift+clique: multi-select em células preenchidas; popup ao soltar Shift. */
  /** Modo 1b — Ctrl+clique: multi-select em células vazias; popup ao soltar Control. */
  /** Modo 1c — drag: seleção por período em células vazias. */
  onCellMouseDown(
    event: MouseEvent,
    employeeId: string,
    day: number,
    cell: ScheduleCellData,
  ): void {
    if (!this.editable() || event.button !== 0 || this.dragActive) return;

    if (event.shiftKey && isDeletableCell(cell)) {
      event.preventDefault();
      this.isSelecting = false;
      this.dragAnchor = null;
      this.previewSelection.set(new Set());
      this.ctrlMultiActive = false;
      this.ctrlMultiEmployeeId = null;
      this.selectedCells.set(new Set());
      this.shiftDeleteMultiActive = true;

      if (this.shiftDeleteEmployeeId && this.shiftDeleteEmployeeId !== employeeId) {
        this.deleteSelectedCells.set(new Set());
      }
      this.shiftDeleteEmployeeId = employeeId;

      const key = selectionKey({ employeeId, day });
      const next = new Set(this.deleteSelectedCells());
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      this.deleteSelectedCells.set(next);
      return;
    }

    if (!isSelectableCell(cell)) return;

    event.preventDefault();

    if (event.ctrlKey) {
      this.shiftDeleteMultiActive = false;
      this.shiftDeleteEmployeeId = null;
      this.deleteSelectedCells.set(new Set());
      this.isSelecting = false;
      this.dragAnchor = null;
      this.previewSelection.set(new Set());
      this.ctrlMultiActive = true;

      if (this.ctrlMultiEmployeeId && this.ctrlMultiEmployeeId !== employeeId) {
        this.selectedCells.set(new Set());
      }
      this.ctrlMultiEmployeeId = employeeId;

      const key = selectionKey({ employeeId, day });
      const next = new Set(this.selectedCells());
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      this.selectedCells.set(next);
      return;
    }

    this.ctrlMultiActive = false;
    this.ctrlMultiEmployeeId = null;
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

  @HostListener('document:keyup', ['$event'])
  onDocumentKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Control' && this.ctrlMultiActive && this.ctrlMultiEmployeeId) {
      this.emitCtrlMultiSelection();
      return;
    }
    if (event.key === 'Shift' && this.shiftDeleteMultiActive && this.shiftDeleteEmployeeId) {
      this.emitShiftDeleteSelection();
    }
  }

  private emitCtrlMultiSelection(): void {
    const keys = [...this.selectedCells()];
    if (keys.length === 0 || !this.ctrlMultiEmployeeId) {
      this.ctrlMultiActive = false;
      return;
    }

    const days = keys
      .filter((k) => k.startsWith(`${this.ctrlMultiEmployeeId}|`))
      .map((k) => Number(k.split('|')[1]))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);

    if (days.length === 0) {
      this.ctrlMultiActive = false;
      return;
    }

    this.ctrlMultiActive = false;
    this.selectionCompleted.emit({
      employeeId: this.ctrlMultiEmployeeId,
      employeeName: this.employeeName(this.ctrlMultiEmployeeId),
      employeeType: this.employeeType(this.ctrlMultiEmployeeId),
      startDay: days[0]!,
      endDay: days[days.length - 1]!,
      days,
    });
  }

  private emitShiftDeleteSelection(): void {
    const keys = [...this.deleteSelectedCells()];
    if (keys.length === 0 || !this.shiftDeleteEmployeeId) {
      this.shiftDeleteMultiActive = false;
      return;
    }

    const days = keys
      .filter((k) => k.startsWith(`${this.shiftDeleteEmployeeId}|`))
      .map((k) => Number(k.split('|')[1]))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);

    if (days.length === 0) {
      this.shiftDeleteMultiActive = false;
      return;
    }

    const cells = days.map((day) => {
      const cell = this.getCell(this.shiftDeleteEmployeeId!, day);
      return {
        day,
        display: cell?.display ?? '',
        kind: cell?.kind ?? ('empty' as ScheduleCellKind),
      };
    });

    this.shiftDeleteMultiActive = false;
    this.deletionSelectionCompleted.emit({
      employeeId: this.shiftDeleteEmployeeId,
      employeeName: this.employeeName(this.shiftDeleteEmployeeId),
      startDay: days[0]!,
      endDay: days[days.length - 1]!,
      days,
      cells,
    });
  }

  private getCell(employeeId: string, day: number): ScheduleCellData | null {
    const dayIndex = this.grid().dayNumbers.indexOf(day);
    if (dayIndex < 0) return null;
    for (const group of this.grid().groups) {
      const row = group.rows.find((r) => r.employeeId === employeeId);
      if (row) return row.cells[dayIndex] ?? null;
    }
    return null;
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    if (this.dragActive) return;
    if (this.ctrlMultiActive) return;
    if (this.shiftDeleteMultiActive) return;
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
      employeeType: this.employeeType(this.dragAnchor.employeeId),
      startDay,
      endDay,
    });
    this.dragAnchor = null;
  }

  clearSelection(): void {
    this.selectedCells.set(new Set());
    this.deleteSelectedCells.set(new Set());
    this.previewSelection.set(new Set());
    this.isSelecting = false;
    this.dragAnchor = null;
    this.ctrlMultiActive = false;
    this.ctrlMultiEmployeeId = null;
    this.shiftDeleteMultiActive = false;
    this.shiftDeleteEmployeeId = null;
  }

  isCellHighlighted(employeeId: string, day: number): boolean {
    const key = selectionKey({ employeeId, day });
    return this.selectedCells().has(key) || this.previewSelection().has(key);
  }

  isCellDeleteHighlighted(employeeId: string, day: number): boolean {
    return this.deleteSelectedCells().has(selectionKey({ employeeId, day }));
  }

  isDragOver(employeeId: string, day: number): boolean {
    return this.dragOverKey() === selectionKey({ employeeId, day });
  }

  isDragging(employeeId: string, day: number): boolean {
    return this.draggingKey() === selectionKey({ employeeId, day });
  }

  /** Modo 2 — drag/drop: células preenchidas. */
  onDragStart(event: DragEvent, employeeId: string, day: number, cell: ScheduleCellData): void {
    if (!this.editable() || !isDraggableCell(cell) || this.shiftDeleteMultiActive) return;
    event.stopPropagation();
    this.isSelecting = false;
    this.dragAnchor = null;
    this.previewSelection.set(new Set());
    this.dragActive = true;

    const key = selectionKey({ employeeId, day });
    this.dragSource = { employeeId, day };
    this.draggingKey.set(key);
    event.dataTransfer?.setData('text/plain', key);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const ghost = target.cloneNode(true) as HTMLElement;
        ghost.style.width = `${target.offsetWidth}px`;
        ghost.style.opacity = '0.85';
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, target.offsetWidth / 2, target.offsetHeight / 2);
        requestAnimationFrame(() => ghost.remove());
      }
    }
  }

  onDragEnd(): void {
    this.draggingKey.set(null);
    this.dragOverKey.set(null);
    this.dragSource = null;
    this.dragActive = false;
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
    event.stopPropagation();
    const source = this.dragSource;
    this.dragSource = null;
    this.draggingKey.set(null);
    this.dragOverKey.set(null);
    this.dragActive = false;
    if (source.employeeId === employeeId && source.day === day) return;
    this.moveRequested.emit({
      source,
      target: { employeeId, day },
    });
  }

  onDragHandleMouseDown(event: MouseEvent): void {
    event.stopPropagation();
  }
}
