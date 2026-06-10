import type {
  OperationalCadastroRow,
  ScheduleAssignmentRow,
  ScheduleMonthResponse,
  Vacation,
} from '../models/api.models';
import type { ScheduleCellData, ScheduleCellKind } from '../models/schedule-grid.models';
import { dateToIso } from './date-format';
import { eachDayInRange } from './date-range-utils';
import {
  mapCellToCalendarDisplay,
  resolveScheduleCell,
  sanitizeAssignmentForGrid,
} from './schedule-cell.mapper';

function isCadastroPreallocDisplayLabel(label: string): boolean {
  const n = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (n === 'SIMULADOR' || n.includes('SIMULADOR')) return true;
  if (n === 'CURSO' || n.includes('CURSO')) return true;
  if (n === 'CMA') return true;
  if (n === 'OUTRO') return true;
  if (n === 'FP' || n.includes('FOLGA PEDIDA')) return true;
  return false;
}

function isGeneratorPreallocDisplayLabel(label: string): boolean {
  const n = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (['ND', 'FOLGA', 'FOLGA SOCIAL', 'FOLGA AGRUPADA', 'FOLGA ANIVERSÁRIO', 'FANI', 'VOO'].includes(n)) {
    return true;
  }
  if (n.includes('FOLGA ANIVERS')) return true;
  if (n.includes('FOLGA') && !n.includes('PEDIDA')) return true;
  return false;
}

export interface DayOccupancy {
  display: string;
  kind: ScheduleCellKind;
  blocked: boolean;
  title?: string;
  source?: OperationalCadastroRow['source'];
}

export type DayOccupancyMap = Record<string, DayOccupancy>;

export interface BuildEmployeeOccupancyInput {
  employeeId: string;
  year: number;
  month: number;
  schedule: ScheduleMonthResponse | null;
}

export function apiDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthDateKey(year: number, month: number, day: number): string {
  return dateToIso(new Date(year, month - 1, day));
}

function occupancyTitle(
  cell: ScheduleCellData,
  meta?: { source?: OperationalCadastroRow['source']; notes?: string | null },
): string {
  const base = cell.title ?? cell.display;
  const parts = [base];
  if (meta?.source) {
    const sourceLabel: Record<OperationalCadastroRow['source'], string> = {
      vacation: 'Férias',
      requested_day_off: 'Folga pedida',
      flight: 'Voo manual',
      pre_allocation: 'Pré-alocação',
    };
    parts.push(`Origem: ${sourceLabel[meta.source]}`);
  }
  if (meta?.notes) {
    parts.push(meta.notes);
  }
  return parts.join(' — ');
}

/**
 * Usa a mesma fonte consolidada da escala: operationalCadastros + assignments.
 */
export function buildEmployeeOccupancyMap(input: BuildEmployeeOccupancyInput): DayOccupancyMap {
  const { employeeId, year, month, schedule } = input;
  const map: DayOccupancyMap = {};
  const days = daysInMonth(year, month);

  const assignmentByDate = new Map<string, ScheduleAssignmentRow>();
  for (const row of schedule?.assignments ?? []) {
    if (row.employeeId === employeeId) {
      assignmentByDate.set(apiDateKey(row.date), row);
    }
  }

  const operationalByDate = new Map<
    string,
    { labels: string[]; source?: OperationalCadastroRow['source']; notes?: string | null }
  >();

  for (const row of schedule?.operationalCadastros ?? []) {
    if (row.employeeId !== employeeId) continue;
    const key = apiDateKey(row.date);
    const bucket = operationalByDate.get(key) ?? { labels: [] };
    bucket.labels.push(row.label);
    bucket.source = row.source;
    if (row.notes) bucket.notes = row.notes;
    operationalByDate.set(key, bucket);
  }

  for (const row of schedule?.preAllocations ?? []) {
    if (row.employeeId !== employeeId) continue;
    const normalized = row.label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    if (normalized.includes('VOO')) continue;
    if (!isCadastroPreallocDisplayLabel(row.label) && !isGeneratorPreallocDisplayLabel(row.label)) {
      continue;
    }
    const key = apiDateKey(row.date);
    const bucket = operationalByDate.get(key) ?? { labels: [] };
    bucket.labels.push(row.label);
    bucket.source = bucket.source ?? 'pre_allocation';
    operationalByDate.set(key, bucket);
  }

  for (let day = 1; day <= days; day++) {
    const key = monthDateKey(year, month, day);
    const bucket = operationalByDate.get(key);
    const cell = resolveScheduleCell(
      sanitizeAssignmentForGrid(assignmentByDate.get(key)),
      bucket?.labels ?? [],
    );
    if (cell.kind === 'empty' || !cell.display) continue;

    const calendar = mapCellToCalendarDisplay(cell);
    map[key] = {
      display: calendar.display,
      kind: cell.kind,
      blocked: true,
      title: occupancyTitle(cell, bucket),
    };
  }

  return map;
}

/** Expande férias em chaves yyyy-mm-dd para testes. */
export function vacationDayKeys(vacation: Vacation): string[] {
  const [sy, sm, sd] = vacation.startDate.slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = vacation.endDate.slice(0, 10).split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  return eachDayInRange(start, end).map(dateToIso);
}
