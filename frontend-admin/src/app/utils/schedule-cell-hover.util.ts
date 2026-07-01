import type { ScheduleCellKind } from '../models/schedule-grid.models';

export interface CellHoverContext {
  shiftStart?: string | null;
  shiftEnd?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

function formatTimeRange(ctx: CellHoverContext): string | null {
  if (ctx.startTime && ctx.endTime) return `${ctx.startTime} – ${ctx.endTime}`;
  if (ctx.shiftStart && ctx.shiftEnd) return `${ctx.shiftStart} – ${ctx.shiftEnd}`;
  return null;
}

export function buildCellHoverDetail(
  kind: ScheduleCellKind,
  display: string,
  ctx: CellHoverContext = {},
): string | undefined {
  const notes = ctx.notes?.trim();
  const timeRange = formatTimeRange(ctx);

  switch (kind) {
    case 'shift':
    case 't6':
    case 't7':
    case 't8':
      return timeRange ? `Turno ${display}\n${timeRange}` : `Turno ${display}`;
    case 'instruction-shift':
      return timeRange ? `Turno em Instrução\n${timeRange}` : 'Turno em Instrução';
    case 'nd':
      return 'Não disponível';
    case 'folga':
      return 'Folga';
    case 'fs':
      return 'Folga social';
    case 'fa':
      return 'Folga agrupada';
    case 'fani':
      return 'Folga aniversário';
    case 'fp':
    case 'fp-weekend':
      return 'Folga pedida';
    case 'folga-weekend':
      return display ? `${display} (sáb+dom — folga social)` : 'Folga social (sáb+dom)';
    case 'ferias':
      return 'Férias';
    case 'voo':
      return notes ? `Voo\n${notes}` : 'Voo';
    case 'simulador': {
      if (timeRange && notes) return `Simulador\n${timeRange}\n${notes}`;
      if (timeRange) return `Simulador\n${timeRange}`;
      if (notes) return `Simulador\n${notes}`;
      return 'Simulador';
    }
    case 'curso':
      return notes ? `Curso\n${notes}` : 'Curso';
    case 'cma':
      return notes ? `CMA\n${notes}` : 'CMA';
    case 'outro':
      return notes || 'Outro';
    default:
      return notes || display || undefined;
  }
}
