import type {
  Employee,
  OperationalCadastroRow,
  PreAllocationRow,
  ScheduleAssignmentRow,
  Shift,
} from '../models/api.models';
import { compareEmployeesBySeniority } from './employee-sort.util';
import { buildCellHoverDetail, type CellHoverContext } from './schedule-cell-hover.util';
import { baseShiftCode, isInstructionShiftCode, isStationShiftCode, toInstructionShiftCode } from './instruction-shift.util';
import { isEmployeeInInstructionOnDate } from './instruction-period.util';

import type {
  EmployeeRowData,
  EmployeeSummaryStats,
  ScheduleCellData,
  ScheduleCellKind,
  ScheduleDayColumn,
  ScheduleGridData,
  ScheduleGridGroup,
} from '../models/schedule-grid.models';



const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function shiftTimesByCode(shifts: Shift[] | undefined): Map<string, { start: string; end: string }> {
  const map = new Map<string, { start: string; end: string }>();
  for (const s of shifts ?? []) {
    map.set(s.code.toUpperCase(), { start: s.startTime, end: s.endTime });
  }
  return map;
}



function normalizeText(value: string): string {

  return value

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toUpperCase()

    .trim();

}



function emptyCell(): ScheduleCellData {

  return { display: '', kind: 'empty' };

}



export function mapShiftToCell(shiftCode: string): ScheduleCellData {
  const code = shiftCode?.toUpperCase() ?? '';
  if (code === 'ND') {
    return { display: 'ND', kind: 'nd', title: 'Não disponível' };
  }
  if (!code) {
    return emptyCell();
  }
  if (isInstructionShiftCode(code)) {
    return { display: code, kind: 'instruction-shift', title: 'Turno em Instrução' };
  }
  return { display: code, kind: 'shift', title: `Turno ${code}` };
}

function normalizeCellForInstructionPeriod(
  cell: ScheduleCellData,
  employee: Employee,
  isoDate: string,
): ScheduleCellData {
  const inInstruction = isEmployeeInInstructionOnDate(employee, isoDate);

  if (cell.kind === 'instruction-shift' && !inInstruction) {
    return mapShiftToCell(baseShiftCode(cell.display));
  }

  if (cell.kind === 'shift' && inInstruction && isStationShiftCode(cell.display)) {
    return mapShiftToCell(toInstructionShiftCode(cell.display));
  }

  return cell;
}



export function mapLabelToCell(label: string, notes?: string | null): ScheduleCellData {

  const n = normalizeText(label);

  if (n === 'FS' || n === 'FOLGA SOCIAL') return { display: 'FS', kind: 'fs', title: label };

  if (n === 'FANI' || n.includes('FOLGA ANIVERS')) {
    return { display: 'FANI', kind: 'fani', title: 'Folga Aniversário' };
  }

  if (n === 'FA' || n === 'FOLGA AGRUPADA') return { display: 'FA', kind: 'fa', title: label };

  if (n === 'FP' || n.includes('FOLGA PEDIDA')) {

    return { display: 'FP', kind: 'fp', title: label };

  }

  if (n.includes('FERIAS')) return { display: 'FER', kind: 'ferias', title: label };

  if (n.includes('VOO')) return { display: 'VOO', kind: 'voo', title: label };

  if (n.includes('SIMULADOR')) return { display: 'SIM', kind: 'simulador', title: label };

  if (n.includes('CURSO')) return { display: 'CRS', kind: 'curso', title: label };

  if (n.includes('CMA')) return { display: 'CMA', kind: 'cma', title: label };

  if (n === 'OUTRO') {
    const desc = notes?.trim();
    return { display: 'OTR', kind: 'outro', title: desc || 'Outro' };
  }

  if (n === 'TURNO') {
    return { display: 'TRN', kind: 'shift', title: 'Solicitação de Turno' };
  }

  if (n === 'ND' || n.includes('ND CONTINUIDADE') || n.startsWith('ND ')) {
    return { display: 'ND', kind: 'nd', title: label };
  }

  if (n === 'T6' || n === 'T7' || n === 'T8' || n === 'T9') {
    return mapShiftToCell(n);
  }

  if (n.includes('FOLGA')) return { display: 'F', kind: 'folga', title: label };

  return { display: label.length > 6 ? label.slice(0, 5) + '…' : label, kind: 'other', title: label };

}



/** Labels operacionais que só podem vir de operationalCadastros, nunca de assignments/preAlloc. */
const CANONICAL_OPERATIONAL_LABELS = new Set([
  'FERIAS',
  'FOLGA PEDIDA',
  'FP',
  'VOO',
  'SIMULADOR',
  'CURSO',
  'CMA',
  'OUTRO',
]);

function normalizeLabelKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function isCanonicalOperationalLabel(label: string): boolean {
  const n = normalizeLabelKey(label);
  if (CANONICAL_OPERATIONAL_LABELS.has(n)) return true;
  if (n.includes('FERIAS')) return true;
  if (n.includes('VOO')) return true;
  if (n.includes('SIMULADOR')) return true;
  if (n.includes('CURSO')) return true;
  if (n === 'CMA') return true;
  if (n === 'OUTRO') return true;
  if (n === 'TURNO') return true;
  if (n.includes('FOLGA PEDIDA') || n === 'FP') return true;
  return false;
}

/** Remove labels operacionais canônicos de assignments — escala usa só operationalCadastros. */
export function sanitizeAssignmentForGrid(
  assignment: ScheduleAssignmentRow | undefined,
): ScheduleAssignmentRow | undefined {
  if (!assignment?.label || !isCanonicalOperationalLabel(assignment.label)) {
    return assignment;
  }
  return { ...assignment, label: null };
}

/** Labels gerados pelo motor em preAllocations que devem aparecer na grade visual. */
const GENERATOR_PREALLOC_DISPLAY_LABELS = new Set([
  'ND',
  'ND CONTINUIDADE',
  'T8',
  'FOLGA',
  'FOLGA SOCIAL',
  'FOLGA AGRUPADA',
  'FOLGA ANIVERSÁRIO',
  'FANI',
  'VOO',
]);

function isGeneratorPreallocDisplayLabel(label: string): boolean {
  const n = normalizeLabelKey(label);
  if (GENERATOR_PREALLOC_DISPLAY_LABELS.has(n)) return true;
  if (n.includes('ND CONTINUIDADE') || n === 'ND') return true;
  if (n.includes('FOLGA ANIVERS')) return true;
  if (n.includes('FOLGA') && !n.includes('PEDIDA')) return true;
  return false;
}

/** Cadastros operacionais persistidos em preAllocations (espelho da realizada e cadastros manuais). */
function isCadastroPreallocDisplayLabel(label: string): boolean {
  const n = normalizeLabelKey(label);
  if (n.includes('FERIAS')) return true;
  if (n.includes('VOO')) return true;
  if (n.includes('FOLGA PEDIDA') || n === 'FP') return true;
  if (n === 'SIMULADOR' || n.includes('SIMULADOR')) return true;
  if (n === 'CURSO' || n.includes('CURSO')) return true;
  if (n === 'CMA') return true;
  if (n === 'OUTRO') return true;
  if (n === 'TURNO') return true;
  return false;
}

function buildPendingPortalPreallocSourceMap(
  preAllocations: PreAllocationRow[],
): Map<string, OperationalLabelSource[]> {
  const map = new Map<string, OperationalLabelSource[]>();

  for (const row of preAllocations) {
    if (!(row.notes ?? '').startsWith('__PENDING__')) continue;
    const key = `${row.employeeId}|${dateKey(row.date)}`;
    const labels = map.get(key) ?? [];
    labels.push({
      label: row.label,
      notes: row.notes ?? null,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
      requestStatus: 'PENDING',
      requestId: row.id,
    });
    map.set(key, labels);
  }
  return map;
}

function buildCadastroPreallocSourceMap(
  preAllocations: PreAllocationRow[],
): Map<string, OperationalLabelSource[]> {
  const map = new Map<string, OperationalLabelSource[]>();

  for (const row of preAllocations) {
    if (!isCadastroPreallocDisplayLabel(row.label)) continue;
    if ((row.notes ?? '').startsWith('__PENDING__')) continue;
    const key = `${row.employeeId}|${dateKey(row.date)}`;
    const labels = map.get(key) ?? [];
    labels.push({
      label: row.label,
      notes: row.notes ?? null,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
    });
    map.set(key, labels);
  }
  return map;
}

export function labelDisplayPriority(label: string): number {
  const n = normalizeText(label);
  if (n.includes('FERIAS')) return 100;
  if (n === 'ND' || n.includes('ND CONTINUIDADE') || n.startsWith('ND ')) return 95;
  if (n === 'T8' || n === 'T6' || n === 'T7' || n === 'T9') return 15;
  if (n === 'FP' || n.includes('FOLGA PEDIDA')) return 90;
  if (n === 'FANI' || n.includes('FOLGA ANIVERS')) return 80;
  if (n.includes('SIMULADOR')) return 70;
  if (n.includes('CURSO')) return 60;
  if (n.includes('CMA')) return 50;
  if (n.includes('VOO')) return 40;
  if (n === 'OUTRO') return 30;
  if (n === 'FS' || n === 'FOLGA SOCIAL') return 28;
  if (n === 'FA' || n === 'FOLGA AGRUPADA') return 27;
  if (n.includes('FOLGA')) return 26;
  return 20;
}

function shiftDisplayPriority(): number {
  return 10;
}

/** Siglas compactas para calendários de cadastro (escala mantém display completo). */
export function mapCellToCalendarDisplay(cell: ScheduleCellData): { display: string; title: string } {
  const title = cell.title ?? cell.display;
  switch (cell.kind) {
    case 'ferias':
      return { display: 'FÉRIAS', title };
    case 'fp':
    case 'fp-weekend':
      return { display: 'FP', title };
    case 'folga-weekend':
      return { display: cell.display, title };
    case 'fani':
      return { display: 'FANI', title };
    case 'voo':
      return { display: 'VOO', title };
    case 'simulador':
      return { display: 'SIM', title };
    case 'curso':
      return { display: 'CRS', title };
    case 'cma':
      return { display: 'CMA', title };
    case 'outro':
      return { display: 'OTR', title };
    default:
      return { display: cell.display, title };
  }
}

export interface OperationalLabelSource {
  label: string;
  notes?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  requestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestId?: string;
}

interface ResolvedCellCandidate {
  priority: number;
  cell: ScheduleCellData;
  hover: CellHoverContext;
  requestId?: string;
}

function withHoverDetail(cell: ScheduleCellData, hover: CellHoverContext): ScheduleCellData {
  const hoverDetail = buildCellHoverDetail(cell.kind, cell.display, hover);
  return hoverDetail ? { ...cell, hoverDetail, title: hoverDetail.split('\n')[0] } : cell;
}

function hoverForShift(shiftCode: string, shiftTimes: Map<string, { start: string; end: string }>): CellHoverContext {
  const base = baseShiftCode(shiftCode);
  const t = shiftTimes.get(base) ?? shiftTimes.get(shiftCode.toUpperCase());
  return t ? { shiftStart: t.start, shiftEnd: t.end } : {};
}

function hoverForOperational(source: OperationalLabelSource): CellHoverContext {
  return {
    notes: source.notes ?? null,
    startTime: source.startTime ?? null,
    endTime: source.endTime ?? null,
  };
}

function applyPendingState(cell: ScheduleCellData, pending: boolean): ScheduleCellData {
  if (!pending) return cell;
  const suffix = ' (aguardando aprovação)';
  return {
    ...cell,
    requestPending: true,
    title: cell.title ? `${cell.title}${suffix}` : `Solicitação${suffix}`,
  };
}

export function resolveScheduleCell(
  assignment: ScheduleAssignmentRow | undefined,
  operationalSources: OperationalLabelSource[],
  shiftTimes: Map<string, { start: string; end: string }> = new Map(),
): ScheduleCellData {
  const candidates: ResolvedCellCandidate[] = [];

  for (const source of operationalSources) {
    const mapped = mapLabelToCell(source.label, source.notes);
    const pending = source.requestStatus === 'PENDING';
    candidates.push({
      priority: labelDisplayPriority(source.label) + (pending ? 10 : 0),
      cell: applyPendingState(mapped, pending),
      hover: hoverForOperational(source),
      requestId: pending ? source.requestId : undefined,
    });
  }

  if (assignment?.label) {
    candidates.push({
      priority: labelDisplayPriority(assignment.label),
      cell: mapLabelToCell(assignment.label),
      hover: {},
    });
  }

  if (assignment?.shiftCode) {
    const code = assignment.shiftCode.toUpperCase();
    candidates.push({
      priority: shiftDisplayPriority(),
      cell: mapShiftToCell(code),
      hover: hoverForShift(code, shiftTimes),
    });
  }

  if (candidates.length === 0) {
    return emptyCell();
  }

  const winner = candidates.sort((a, b) => b.priority - a.priority)[0];
  const cell = withHoverDetail(winner.cell, winner.hover);
  if (winner.requestId) {
    return { ...cell, requestId: winner.requestId };
  }
  return cell;
}



function computeDisplayWorkDays(stats: EmployeeSummaryStats): number {
  return (
    stats.turnos +
    stats.nd +
    stats.voos +
    stats.simuladores +
    stats.cursos +
    stats.cma +
    stats.outros
  );
}

function countForSummary(cell: ScheduleCellData, stats: EmployeeSummaryStats): void {

  switch (cell.kind) {
    case 'shift': {
      const d = cell.display.toUpperCase();
      if (d === 'T6') {
        stats.t6++;
        stats.turnos++;
      } else if (d === 'T7') {
        stats.t7++;
        stats.turnos++;
      } else if (d === 'T8') {
        stats.t8++;
        stats.turnos++;
      } else if (['T1', 'T2', 'T3', 'T4'].includes(d)) {
        stats.turnos++;
      } else {
        stats.turnos++;
      }
      break;
    }

    case 'instruction-shift': {
      const base = baseShiftCode(cell.display);
      if (base === 'T6') {
        stats.t6++;
        stats.turnos++;
      } else if (base === 'T7') {
        stats.t7++;
        stats.turnos++;
      } else if (base === 'T8') {
        stats.t8++;
        stats.turnos++;
      } else {
        stats.turnos++;
      }
      break;
    }

    case 't6':

      stats.t6++;

      stats.turnos++;

      break;

    case 't7':

      stats.t7++;

      stats.turnos++;

      break;

    case 't8':

      stats.t8++;

      stats.turnos++;

      break;

    case 'nd':

      stats.nd++;

      break;

    case 'folga':

      stats.folgas++;

      break;

    case 'fs':

      stats.folgaSocial++;

      stats.folgas++;

      break;

    case 'fa':

      stats.fa++;

      stats.folgas++;

      break;

    case 'fani':

      stats.fani++;

      stats.folgas++;

      break;

    case 'fp':

      stats.fp++;

      stats.folgas++;

      break;

    case 'fp-weekend':
    case 'folga-weekend':
      incrementWeekendFolgaStats(stats, cell.folgaBaseKind ?? 'fp');
      break;

    case 'empty':

      stats.disponivel++;

      break;

    case 'ferias':

      stats.ferias++;

      break;

    case 'voo':

      stats.voos++;

      break;

    case 'simulador':

      stats.simuladores++;

      break;

    case 'curso':

      stats.cursos++;

      break;

    case 'cma':

      stats.cma++;

      break;

    case 'outro':

      stats.outros++;

      break;

  }

}



function emptySummary(): EmployeeSummaryStats {

  return {

    t6: 0,

    t7: 0,

    t8: 0,

    nd: 0,

    turnos: 0,

    diasTrabalhados: 0,

    folgas: 0,

    folgaSocial: 0,

    folgaSocialOk: false,

    fa: 0,

    fani: 0,

    fp: 0,

    ferias: 0,

    vooDisp: 0,

    disponivel: 0,

    maxConsec: 0,

    status: 'OK',
    statusReason: null,

    voos: 0,

    simuladores: 0,

    cursos: 0,

    cma: 0,

    outros: 0,

  };

}



function dateKey(iso: string): string {

  const d = new Date(iso);

  const y = d.getUTCFullYear();

  const m = String(d.getUTCMonth() + 1).padStart(2, '0');

  const day = String(d.getUTCDate()).padStart(2, '0');

  return `${y}-${m}-${day}`;

}



function daysInMonth(year: number, month: number): number {

  return new Date(year, month, 0).getDate();

}



function isFolgaCell(cell: ScheduleCellData): boolean {
  return cell.kind === 'folga' || cell.kind === 'fp' || cell.kind === 'fs' || cell.kind === 'fa' || cell.kind === 'fani';
}

function incrementWeekendFolgaStats(stats: EmployeeSummaryStats, baseKind: ScheduleCellKind): void {
  switch (baseKind) {
    case 'fp':
      stats.fp++;
      break;
    case 'fa':
      stats.fa++;
      break;
    case 'fani':
      stats.fani++;
      break;
    case 'folga':
    case 'fs':
      break;
  }
  stats.folgaSocial++;
  stats.folgas++;
}

function asWeekendFolgaSocial(cell: ScheduleCellData): ScheduleCellData {
  const baseDetail = cell.hoverDetail ?? buildCellHoverDetail(cell.kind, cell.display);
  return {
    ...cell,
    kind: 'folga-weekend',
    folgaBaseKind: cell.kind,
    hoverDetail: baseDetail ? `${baseDetail}\n(sáb+dom — folga social)` : '(sáb+dom — folga social)',
  };
}

/** Sábado e domingo com qualquer folga usam cor de folga social, mantendo a sigla original. */
function applyWeekendFolgaSocialStyle(cells: ScheduleCellData[], year: number, month: number): void {
  for (let day = 1; day <= cells.length; day++) {
    const satIdx = day - 1;
    const satDate = new Date(year, month - 1, day);
    if (satDate.getDay() !== 6 || day >= cells.length) continue;

    const satCell = cells[satIdx];
    const domCell = cells[satIdx + 1];
    if (!isFolgaCell(satCell) || !isFolgaCell(domCell)) continue;

    cells[satIdx] = asWeekendFolgaSocial(satCell);
    cells[satIdx + 1] = asWeekendFolgaSocial(domCell);
  }
}

function buildEmployeeRow(
  employee: Employee,
  year: number,
  month: number,
  days: number,
  assignmentMap: Map<string, ScheduleAssignmentRow>,
  operationalSourceMap: Map<string, OperationalLabelSource[]>,
  shiftTimes: Map<string, { start: string; end: string }>,
): EmployeeRowData {
  const cells: ScheduleCellData[] = [];
  const summary = emptySummary();

  for (let day = 1; day <= days; day++) {
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const key = `${employee.id}|${isoDate}`;
    const cell = normalizeCellForInstructionPeriod(
      resolveScheduleCell(
        sanitizeAssignmentForGrid(assignmentMap.get(key)),
        operationalSourceMap.get(key) ?? [],
        shiftTimes,
      ),
      employee,
      isoDate,
    );
    cells.push(cell);
  }

  applyWeekendFolgaSocialStyle(cells, year, month);

  for (const cell of cells) {
    countForSummary(cell, summary);
  }

  summary.folgaSocialOk = summary.folgaSocial >= 2;
  summary.diasTrabalhados = computeDisplayWorkDays(summary);



  return {

    employeeId: employee.id,

    name: employee.name,

    type: employee.type,

    cells,

    summary,

  };

}



export interface BuildGridPreviousMonthInput {
  year: number;
  month: number;
  assignments: ScheduleAssignmentRow[];
  preAllocations: PreAllocationRow[];
  operationalCadastros?: OperationalCadastroRow[];
}

export interface BuildGridInput {
  year: number;
  month: number;
  employees: Employee[];
  assignments: ScheduleAssignmentRow[];
  preAllocations: PreAllocationRow[];
  operationalCadastros?: OperationalCadastroRow[];
  shifts?: Shift[];
  /**
   * Quando > 0, antepõe os últimos N dias do mês anterior (somente visualização).
   * Usado na escala não publicada.
   */
  leadDays?: number;
  previousMonth?: BuildGridPreviousMonthInput | null;
  shiftSwaps?: Array<{
    id: string;
    kind?: 'PEER' | 'SELF' | string;
    date: string;
    targetDate?: string | null;
    pairLength?: number;
    requesterDates?: string[];
    targetDates?: string[];
    requesterEmployeeId: string;
    requesterName: string;
    requesterShiftCode: string;
    targetEmployeeId: string;
    targetName: string;
    targetShiftCode: string;
    status: 'OFFERED' | 'AWAITING_ADMIN' | string;
  }>;
}



function buildOperationalSourceMap(
  operationalCadastros: OperationalCadastroRow[] | undefined,
  preAllocById: Map<string, PreAllocationRow>,
): Map<string, OperationalLabelSource[]> {
  const map = new Map<string, OperationalLabelSource[]>();

  for (const row of operationalCadastros ?? []) {
    const key = `${row.employeeId}|${dateKey(row.date)}`;
    const labels = map.get(key) ?? [];
    const pre = row.source === 'pre_allocation' ? preAllocById.get(row.id) : undefined;
    const requestStatus = row.metadata?.['requestStatus'] as OperationalLabelSource['requestStatus'] | undefined;
    const requestId = row.metadata?.['requestId'] as string | undefined;
    labels.push({
      label: row.label,
      notes: row.notes ?? pre?.notes ?? null,
      startTime: pre?.startTime ?? null,
      endTime: pre?.endTime ?? null,
      requestStatus,
      requestId,
    });
    map.set(key, labels);
  }
  return map;
}

/** ND e folgas geradas pelo motor vêm em preAllocations — não em operationalCadastros. */
function buildGeneratorPreallocSourceMap(
  preAllocations: PreAllocationRow[],
): Map<string, OperationalLabelSource[]> {
  const map = new Map<string, OperationalLabelSource[]>();

  for (const row of preAllocations) {
    if (!isGeneratorPreallocDisplayLabel(row.label)) continue;
    if ((row.notes ?? '').startsWith('__PENDING__')) continue;
    const key = `${row.employeeId}|${dateKey(row.date)}`;
    const labels = map.get(key) ?? [];
    labels.push({
      label: row.label,
      notes: row.notes ?? null,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
    });
    map.set(key, labels);
  }
  return map;
}

function mergeSourceMaps(
  primary: Map<string, OperationalLabelSource[]>,
  secondary: Map<string, OperationalLabelSource[]>,
): Map<string, OperationalLabelSource[]> {
  const merged = new Map(primary);
  for (const [key, labels] of secondary) {
    const existing = merged.get(key) ?? [];
    merged.set(key, [...existing, ...labels]);
  }
  return merged;
}

function applyShiftSwapsToRows(
  rows: EmployeeRowData[],
  year: number,
  month: number,
  shiftSwaps: BuildGridInput['shiftSwaps'],
): void {
  if (!shiftSwaps?.length) return;
  const rowById = new Map(rows.map((r) => [r.employeeId, r]));
  const days = daysInMonth(year, month);

  const activeSwaps = shiftSwaps.filter(
    (s) => s.status === 'OFFERED' || s.status === 'AWAITING_ADMIN',
  );
  // Cor estável por par: mesma cor nos dois lados; pares diferentes = cores diferentes.
  const colorBySwapId = new Map(
    [...activeSwaps]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s, i) => [s.id, i % 8] as const),
  );

  const markCell = (
    row: EmployeeRowData | undefined,
    day: number,
    meta: NonNullable<ScheduleCellData['shiftSwap']>,
    title: string,
    hoverDetail: string,
  ) => {
    if (!row || day < 1 || day > days || !row.cells[day - 1]) return;
    const cell = row.cells[day - 1]!;
    row.cells[day - 1] = {
      ...cell,
      shiftSwap: meta,
      title,
      hoverDetail,
    };
  };

  const partAt = (joined: string | undefined, index: number): string => {
    const parts = (joined ?? '')
      .split('+')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return '';
    return parts[Math.min(index, parts.length - 1)] ?? '';
  };

  const preferCode = (cellDisplay: string | undefined, stored: string): string => {
    const disp = (cellDisplay ?? '').trim();
    if (disp && disp.toLowerCase() !== 'em branco') return disp;
    const s = (stored ?? '').trim();
    if (s && s.toLowerCase() !== 'em branco') return s;
    return disp || s || '';
  };

  for (const swap of shiftSwaps) {
    if (swap.status !== 'OFFERED' && swap.status !== 'AWAITING_ADMIN') continue;

    const sourceDays = daysFromIsoList(
      swap.requesterDates,
      swap.date,
      swap.pairLength ?? 1,
    );
    const targetDays = daysFromIsoList(
      swap.targetDates,
      swap.targetDate ?? swap.date,
      swap.pairLength ?? 1,
    );
    if (sourceDays.length < 1 || targetDays.length < 1) continue;
    const n = Math.min(sourceDays.length, targetDays.length);
    const colorIndex = colorBySwapId.get(swap.id) ?? 0;

    if (swap.kind === 'SELF') {
      const row = rowById.get(swap.requesterEmployeeId);
      const statusLabel = 'Realocação na própria escala';
      for (let i = 0; i < n; i++) {
        const sDay = sourceDays[i]!;
        const tDay = targetDays[i]!;
        const srcCode = preferCode(row?.cells[sDay - 1]?.display, partAt(swap.requesterShiftCode, i));
        const dstCode = preferCode(row?.cells[tDay - 1]?.display, partAt(swap.targetShiftCode, i));
        markCell(
          row,
          sDay,
          {
            id: swap.id,
            status: swap.status,
            role: 'requester',
            counterpartName: 'sua escala',
            counterpartShiftCode: dstCode,
            ownShiftCode: srcCode,
            requesterName: swap.requesterName,
            targetName: swap.requesterName,
            requesterShiftCode: srcCode,
            targetShiftCode: dstCode,
            sourceDate: swap.date,
            targetDate: swap.targetDate,
            colorIndex,
          },
          `${statusLabel}: ${srcCode} ↔ ${dstCode}`,
          `${statusLabel}\n${srcCode} ↔ ${dstCode}`,
        );
        markCell(
          row,
          tDay,
          {
            id: swap.id,
            status: swap.status,
            role: 'requester',
            counterpartName: 'sua escala',
            counterpartShiftCode: srcCode,
            ownShiftCode: dstCode,
            requesterName: swap.requesterName,
            targetName: swap.requesterName,
            requesterShiftCode: srcCode,
            targetShiftCode: dstCode,
            sourceDate: swap.date,
            targetDate: swap.targetDate,
            colorIndex,
          },
          `${statusLabel}: destino ↔ origem`,
          `${statusLabel}\n${dstCode} ↔ ${srcCode}`,
        );
      }
      continue;
    }

    const requesterRow = rowById.get(swap.requesterEmployeeId);
    const targetRow = rowById.get(swap.targetEmployeeId);
    const statusLabel =
      swap.status === 'OFFERED'
        ? 'Troca ofertada (aguardando colaborador)'
        : 'Troca aceita';
    const destDateLabel = swap.targetDate ?? swap.date;

    for (let i = 0; i < n; i++) {
      const sDay = sourceDays[i]!;
      const tDay = targetDays[i]!;
      const reqCode = preferCode(
        requesterRow?.cells[sDay - 1]?.display,
        partAt(swap.requesterShiftCode, i),
      );
      const tgtCode = preferCode(
        targetRow?.cells[tDay - 1]?.display,
        partAt(swap.targetShiftCode, i),
      );
      markCell(
        requesterRow,
        sDay,
        {
          id: swap.id,
          status: swap.status,
          role: 'requester',
          counterpartName: swap.targetName,
          counterpartShiftCode: tgtCode,
          ownShiftCode: reqCode,
          requesterName: swap.requesterName,
          targetName: swap.targetName,
          requesterShiftCode: reqCode,
          targetShiftCode: tgtCode,
          sourceDate: swap.date,
          targetDate: destDateLabel,
          colorIndex,
        },
        `${statusLabel}: ${swap.requesterName} (solicitante) ${reqCode} com ${tgtCode} ${swap.targetName}`,
        `${statusLabel}\n${swap.requesterName} (solicitante) ${reqCode} com ${tgtCode} ${swap.targetName}`,
      );
      markCell(
        targetRow,
        tDay,
        {
          id: swap.id,
          status: swap.status,
          role: 'target',
          counterpartName: swap.requesterName,
          counterpartShiftCode: reqCode,
          ownShiftCode: tgtCode,
          requesterName: swap.requesterName,
          targetName: swap.targetName,
          requesterShiftCode: reqCode,
          targetShiftCode: tgtCode,
          sourceDate: swap.date,
          targetDate: destDateLabel,
          colorIndex,
        },
        `${statusLabel}: ${swap.requesterName} (solicitante) ${reqCode} com ${tgtCode} ${swap.targetName}`,
        `${statusLabel}\n${swap.requesterName} (solicitante) ${reqCode} com ${tgtCode} ${swap.targetName}`,
      );
    }
  }
}

/** Marca células de trocas já aprovadas (canto vermelho discreto). */
function applyApprovedSwapMarksToRows(
  rows: EmployeeRowData[],
  year: number,
  month: number,
  shiftSwaps: BuildGridInput['shiftSwaps'],
): void {
  if (!shiftSwaps?.length) return;
  const rowById = new Map(rows.map((r) => [r.employeeId, r]));
  const days = daysInMonth(year, month);

  const markApplied = (row: EmployeeRowData | undefined, day: number) => {
    if (!row || day < 1 || day > days || !row.cells[day - 1]) return;
    const cell = row.cells[day - 1]!;
    // Não sobrescreve destaque de troca ainda ativa.
    if (cell.shiftSwap) return;
    row.cells[day - 1] = {
      ...cell,
      swapApplied: true,
      title: cell.title ?? 'Troca aceita',
      hoverDetail: cell.hoverDetail ?? 'Turno trocado (troca aceita).',
    };
  };

  for (const swap of shiftSwaps) {
    if (swap.status !== 'APPROVED') continue;

    const sourceDays = daysFromIsoList(
      swap.requesterDates,
      swap.date,
      swap.pairLength ?? 1,
    );
    const targetDays = daysFromIsoList(
      swap.targetDates,
      swap.targetDate ?? swap.date,
      swap.pairLength ?? 1,
    );
    if (sourceDays.length < 1 || targetDays.length < 1) continue;
    const n = Math.min(sourceDays.length, targetDays.length);

    if (swap.kind === 'SELF') {
      const row = rowById.get(swap.requesterEmployeeId);
      for (let i = 0; i < n; i++) {
        markApplied(row, sourceDays[i]!);
        markApplied(row, targetDays[i]!);
      }
      continue;
    }

    const requesterRow = rowById.get(swap.requesterEmployeeId);
    const targetRow = rowById.get(swap.targetEmployeeId);
    for (let i = 0; i < n; i++) {
      markApplied(requesterRow, sourceDays[i]!);
      markApplied(targetRow, targetDays[i]!);
    }
  }
}

function daysFromIsoList(
  dates: string[] | undefined | null,
  fallbackStart: string | null | undefined,
  pairLength: number,
): number[] {
  if (dates && dates.length > 0) {
    return dates
      .map((d) => Number(String(d).slice(8, 10)))
      .filter((d) => Number.isInteger(d) && d >= 1);
  }
  if (!fallbackStart) return [];
  const start = Number(String(fallbackStart).slice(8, 10));
  if (!Number.isInteger(start) || start < 1) return [];
  const n = Math.max(1, pairLength || 1);
  return Array.from({ length: n }, (_, i) => start + i);
}

function addDaysLabel(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return String(dt.getUTCDate()).padStart(2, '0');
}

function buildDayColumn(
  year: number,
  month: number,
  day: number,
  opts: { isLead: boolean; isMonthStart: boolean; leadIndex: number },
): ScheduleDayColumn {
  const wd = new Date(year, month - 1, day).getDay();
  const weekdayLabel = WEEKDAYS[wd]!;
  return {
    isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    day,
    year,
    month,
    weekdayLabel,
    isWeekend: weekdayLabel === 'Dom' || weekdayLabel === 'Sáb',
    isLead: opts.isLead,
    isMonthStart: opts.isMonthStart,
    leadIndex: opts.leadIndex,
  };
}

function buildOperationalMapsForMonth(
  assignments: ScheduleAssignmentRow[],
  preAllocations: PreAllocationRow[],
  operationalCadastros: OperationalCadastroRow[] | undefined,
): {
  assignmentMap: Map<string, ScheduleAssignmentRow>;
  operationalSourceMap: Map<string, OperationalLabelSource[]>;
} {
  const assignmentMap = new Map<string, ScheduleAssignmentRow>();
  for (const a of assignments) {
    assignmentMap.set(`${a.employeeId}|${dateKey(a.date)}`, a);
  }

  const preAllocById = new Map(preAllocations.map((p) => [p.id, p]));
  const operationalSourceMap = mergeSourceMaps(
    buildOperationalSourceMap(operationalCadastros, preAllocById),
    mergeSourceMaps(
      buildPendingPortalPreallocSourceMap(preAllocations),
      mergeSourceMaps(
        buildCadastroPreallocSourceMap(preAllocations),
        buildGeneratorPreallocSourceMap(preAllocations),
      ),
    ),
  );

  return { assignmentMap, operationalSourceMap };
}

export function buildScheduleGrid(input: BuildGridInput): ScheduleGridData {
  const {
    year,
    month,
    employees,
    assignments,
    preAllocations,
    operationalCadastros,
    shifts,
    shiftSwaps,
    leadDays: leadDaysRaw = 0,
    previousMonth,
  } = input;
  const days = daysInMonth(year, month);
  const shiftTimes = shiftTimesByCode(shifts);
  const dayNumbers = Array.from({ length: days }, (_, i) => i + 1);
  const weekdayLabels = dayNumbers.map((d) => {
    const wd = new Date(year, month - 1, d).getDay();
    return WEEKDAYS[wd]!;
  });

  const leadDays = Math.max(0, Math.floor(leadDaysRaw));
  const prevYear = previousMonth?.year ?? (month === 1 ? year - 1 : year);
  const prevMonthNum = previousMonth?.month ?? (month === 1 ? 12 : month - 1);
  const prevDaysTotal = daysInMonth(prevYear, prevMonthNum);
  const effectiveLeadDays = leadDays > 0 ? Math.min(leadDays, prevDaysTotal) : 0;
  const leadStartDay = prevDaysTotal - effectiveLeadDays + 1;

  const leadColumns: ScheduleDayColumn[] =
    effectiveLeadDays > 0
      ? Array.from({ length: effectiveLeadDays }, (_, i) =>
          buildDayColumn(prevYear, prevMonthNum, leadStartDay + i, {
            isLead: true,
            isMonthStart: false,
            leadIndex: i,
          }),
        )
      : [];

  const currentColumns: ScheduleDayColumn[] = dayNumbers.map((d) =>
    buildDayColumn(year, month, d, {
      isLead: false,
      isMonthStart: d === 1 && effectiveLeadDays > 0,
      leadIndex: -1,
    }),
  );

  const columns: ScheduleDayColumn[] = [...leadColumns, ...currentColumns];

  const { assignmentMap, operationalSourceMap } = buildOperationalMapsForMonth(
    assignments,
    preAllocations,
    operationalCadastros,
  );

  const prevMaps =
    effectiveLeadDays > 0
      ? buildOperationalMapsForMonth(
          previousMonth?.assignments ?? [],
          previousMonth?.preAllocations ?? [],
          previousMonth?.operationalCadastros,
        )
      : null;

  const employeeById = new Map(employees.map((e) => [e.id, e]));

  for (const a of assignments) {
    if (a.employee && !employeeById.has(a.employeeId)) {
      employeeById.set(a.employeeId, a.employee);
    }
  }
  for (const p of preAllocations) {
    if (p.employee && !employeeById.has(p.employeeId)) {
      employeeById.set(p.employeeId, p.employee);
    }
  }
  for (const c of operationalCadastros ?? []) {
    const emp = employees.find((e) => e.id === c.employeeId);
    if (emp && !employeeById.has(c.employeeId)) {
      employeeById.set(c.employeeId, emp);
    }
  }

  const allEmployees = [...employeeById.values()].sort(compareEmployeesBySeniority);

  const paoRows: EmployeeRowData[] = [];
  const apaoRows: EmployeeRowData[] = [];

  for (const emp of allEmployees) {
    const row = buildEmployeeRow(
      emp,
      year,
      month,
      days,
      assignmentMap,
      operationalSourceMap,
      shiftTimes,
    );

    if (prevMaps && effectiveLeadDays > 0) {
      const prevRow = buildEmployeeRow(
        emp,
        prevYear,
        prevMonthNum,
        prevDaysTotal,
        prevMaps.assignmentMap,
        prevMaps.operationalSourceMap,
        shiftTimes,
      );
      row.leadCells = prevRow.cells.slice(leadStartDay - 1);
    }

    if (emp.type === 'PAO') {
      paoRows.push(row);
    } else {
      apaoRows.push(row);
    }
  }

  applyShiftSwapsToRows([...paoRows, ...apaoRows], year, month, shiftSwaps);
  applyApprovedSwapMarksToRows([...paoRows, ...apaoRows], year, month, shiftSwaps);

  const groups: ScheduleGridGroup[] = [];

  if (paoRows.length) {
    groups.push({ type: 'PAO', label: 'PAO', rows: paoRows });
  }

  if (apaoRows.length) {
    groups.push({ type: 'APAO', label: 'APAO', rows: apaoRows });
  }

  return {
    year,
    month,
    daysInMonth: days,
    dayNumbers,
    weekdayLabels,
    columns,
    leadDayCount: effectiveLeadDays,
    groups,
  };
}



export function cellKindClass(kind: ScheduleCellKind, display?: string, requestPending?: boolean): string {
  const base =
    kind === 'empty'
      ? 'cell-empty'
      : kind === 'instruction-shift'
        ? 'cell-instruction'
        : kind === 'fp-weekend' || kind === 'folga-weekend'
          ? 'cell-folga-weekend'
          : kind === 'shift' && display
            ? (() => {
                const code = display.toUpperCase();
                if (code === 'T6' || code === 'T7' || code === 'T8' || code === 'T9') {
                  return `cell-${code.toLowerCase()}`;
                }
                return `cell-${kind}`;
              })()
            : `cell-${kind}`;
  return requestPending ? `${base} cell-pending` : base;
}

