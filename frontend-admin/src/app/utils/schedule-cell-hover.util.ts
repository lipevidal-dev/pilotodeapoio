import type { ScheduleCellKind } from '../models/schedule-grid.models';

export interface CellHoverContext {
  shiftStart?: string | null;
  shiftEnd?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

/** Prefixos/marcadores internos — não devem aparecer no hover. */
const INTERNAL_NOTE_PREFIXES = [
  '__PENDING__',
  '__PORTAL_APPROVED__',
  '__PORTAL_FP__',
  'auto:',
  'escala-manual',
  'cross-month:',
] as const;

/**
 * Extrai a observação legível para o hover (remove marcadores de portal/sistema).
 */
export function sanitizeHoverNotes(notes?: string | null): string | null {
  if (!notes) return null;
  let text = notes.trim();
  if (!text) return null;

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of INTERNAL_NOTE_PREFIXES) {
      if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        text = text.slice(prefix.length).trim();
        changed = true;
      }
    }
  }

  if (!text) return null;
  // Marcador puro sem texto do usuário.
  if (/^(auto:|escala-manual|cross-month:)/i.test(text)) return null;
  return text;
}

function formatTimeRange(ctx: CellHoverContext): string | null {
  if (ctx.startTime && ctx.endTime) return `${ctx.startTime} – ${ctx.endTime}`;
  if (ctx.shiftStart && ctx.shiftEnd) return `${ctx.shiftStart} – ${ctx.shiftEnd}`;
  return null;
}

function withNotes(base: string, notes: string | null): string {
  return notes ? `${base}\n${notes}` : base;
}

export function buildCellHoverDetail(
  kind: ScheduleCellKind,
  display: string,
  ctx: CellHoverContext = {},
): string | undefined {
  const notes = sanitizeHoverNotes(ctx.notes);
  const timeRange = formatTimeRange(ctx);

  switch (kind) {
    case 'shift':
    case 't6':
    case 't7':
    case 't8': {
      // Pré-alocação / solicitação genérica "TURNO" aparece como TRN na grade.
      if (display.toUpperCase() === 'TRN') {
        return withNotes('Solicitação de Turno', notes);
      }
      const base = timeRange ? `Turno ${display}\n${timeRange}` : `Turno ${display}`;
      return withNotes(base, notes);
    }
    case 'instruction-shift': {
      const base = timeRange ? `Turno em Instrução\n${timeRange}` : 'Turno em Instrução';
      return withNotes(base, notes);
    }
    case 'nd':
      return withNotes('Não disponível', notes);
    case 'folga':
      return withNotes('Folga', notes);
    case 'fs':
      return withNotes('Folga social', notes);
    case 'fa':
      return withNotes('Folga agrupada', notes);
    case 'fani':
      return withNotes('Folga aniversário', notes);
    case 'fp':
    case 'fp-weekend':
      return withNotes('Folga pedida', notes);
    case 'folga-weekend': {
      const base = display ? `${display} (sáb+dom — folga social)` : 'Folga social (sáb+dom)';
      return withNotes(base, notes);
    }
    case 'ferias':
      return withNotes('Férias', notes);
    case 'voo':
      return withNotes('Voo', notes);
    case 'simulador': {
      if (timeRange && notes) return `Simulador\n${timeRange}\n${notes}`;
      if (timeRange) return `Simulador\n${timeRange}`;
      if (notes) return `Simulador\n${notes}`;
      return 'Simulador';
    }
    case 'curso':
      return withNotes('Curso', notes);
    case 'cma':
      return withNotes('CMA', notes);
    case 'outro':
      return notes || 'Outro';
    default:
      return notes || display || undefined;
  }
}
