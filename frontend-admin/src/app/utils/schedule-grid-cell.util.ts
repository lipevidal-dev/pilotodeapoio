import type { ScheduleCellData, ScheduleCellKind } from '../models/schedule-grid.models';

const DRAGGABLE_KINDS = new Set<ScheduleCellKind>([
  'shift',
  't6',
  't7',
  't8',
  'nd',
  'folga',
  'fs',
  'fa',
  'fani',
  'fp',
  'fp-weekend',
  'folga-weekend',
  'voo',
  'simulador',
  'curso',
  'cma',
  'outro',
  'other',
]);

/** Célula vazia — inicia seleção por período (drag-select). */
export function isSelectableCell(cell: ScheduleCellData): boolean {
  return cell.kind === 'empty';
}

/** Célula preenchida — inicia drag/drop para mover alocação. */
export function isDraggableCell(cell: ScheduleCellData): boolean {
  return DRAGGABLE_KINDS.has(cell.kind);
}

/** Célula com alocação removível — Shift+clique para exclusão. */
export function isDeletableCell(cell: ScheduleCellData): boolean {
  return isDraggableCell(cell);
}

/** Exclusão pode exigir confirmação forçada no backend (FP, ND, T8). */
export function isProtectedDeletableCell(cell: ScheduleCellData): boolean {
  if (cell.kind === 'folga-weekend' || cell.kind === 'fp-weekend') {
    return cell.folgaBaseKind === 'fp' || cell.kind === 'fp-weekend';
  }
  return cell.kind === 'fp' || cell.kind === 'nd' || cell.kind === 't8';
}
