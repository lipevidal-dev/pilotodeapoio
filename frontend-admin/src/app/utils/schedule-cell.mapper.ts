import type {
  Employee,
  OperationalCadastroRow,
  PreAllocationRow,
  ScheduleAssignmentRow,
} from '../models/api.models';
import { compareEmployeesBySeniority } from './employee-sort.util';

import type {

  EmployeeRowData,

  EmployeeSummaryStats,

  ScheduleCellData,

  ScheduleCellKind,

  ScheduleGridData,

  ScheduleGridGroup,

} from '../models/schedule-grid.models';



const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];



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
  return { display: code, kind: 'shift', title: `Turno ${code}` };
}



export function mapLabelToCell(label: string): ScheduleCellData {

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

  if (n.includes('SIMULADOR')) return { display: 'SIMULADOR', kind: 'simulador', title: label };

  if (n.includes('CURSO')) return { display: 'CURSO', kind: 'curso', title: label };

  if (n.includes('CMA')) return { display: 'CMA', kind: 'cma', title: label };

  if (n === 'OUTRO') return { display: 'OUTRO', kind: 'outro', title: label };

  if (n === 'ND') return { display: 'ND', kind: 'nd', title: label };

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
  if (n.includes('FOLGA ANIVERS')) return true;
  if (n.includes('FOLGA') && !n.includes('PEDIDA')) return true;
  return false;
}

export function labelDisplayPriority(label: string): number {
  const n = normalizeText(label);
  if (n.includes('FERIAS')) return 100;
  if (n === 'ND') return 95;
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
    case 'fani':
      return { display: 'FANI', title };
    case 'voo':
      return { display: 'VOO', title };
    case 'simulador':
      return { display: 'SIM', title };
    case 'curso':
      return { display: 'CURSO', title };
    case 'cma':
      return { display: 'CMA', title };
    case 'outro':
      return { display: 'OUTRO', title };
    default:
      return { display: cell.display, title };
  }
}

export function resolveScheduleCell(
  assignment: ScheduleAssignmentRow | undefined,
  operationalLabels: string[],
): ScheduleCellData {
  const candidates: Array<{ priority: number; cell: ScheduleCellData }> = [];

  for (const label of operationalLabels) {
    candidates.push({ priority: labelDisplayPriority(label), cell: mapLabelToCell(label) });
  }

  if (assignment?.label) {
    candidates.push({
      priority: labelDisplayPriority(assignment.label),
      cell: mapLabelToCell(assignment.label),
    });
  }

  if (assignment?.shiftCode) {
    candidates.push({
      priority: shiftDisplayPriority(),
      cell: mapShiftToCell(assignment.shiftCode),
    });
  }

  if (candidates.length === 0) {
    return emptyCell();
  }

  return candidates.sort((a, b) => b.priority - a.priority)[0].cell;
}



function countForSummary(cell: ScheduleCellData, stats: EmployeeSummaryStats): void {

  switch (cell.kind) {
    case 'shift': {
      const d = cell.display.toUpperCase();
      if (d === 'T6') {
        stats.t6++;
        stats.turnos++;
        stats.diasTrabalhados++;
      } else if (d === 'T7') {
        stats.t7++;
        stats.turnos++;
        stats.diasTrabalhados++;
      } else if (d === 'T8') {
        stats.t8++;
        stats.turnos++;
        stats.diasTrabalhados++;
      } else if (['T1', 'T2', 'T3', 'T4'].includes(d)) {
        stats.turnos++;
        stats.diasTrabalhados++;
      } else {
        stats.diasTrabalhados++;
      }
      break;
    }

    case 't6':

      stats.t6++;

      stats.turnos++;

      stats.diasTrabalhados++;

      break;

    case 't7':

      stats.t7++;

      stats.turnos++;

      stats.diasTrabalhados++;

      break;

    case 't8':

      stats.t8++;

      stats.turnos++;

      stats.diasTrabalhados++;

      break;

    case 'nd':

      stats.nd++;

      stats.diasTrabalhados++;

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

      stats.fp++;

      stats.folgaSocial++;

      stats.folgas++;

      break;

    case 'empty':

      stats.disponivel++;

      break;

    case 'ferias':

      stats.ferias++;

      break;

    case 'voo':

      stats.voos++;

      stats.diasTrabalhados++;

      break;

    case 'simulador':

      stats.simuladores++;

      stats.diasTrabalhados++;

      break;

    case 'curso':

      stats.cursos++;

      stats.diasTrabalhados++;

      break;

    case 'cma':

      stats.cma++;

      stats.diasTrabalhados++;

      break;

    case 'outro':

      stats.outros++;

      stats.diasTrabalhados++;

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



function isFpCell(cell: ScheduleCellData): boolean {
  return cell.kind === 'fp';
}

/** FP em sábado e domingo consecutivos equivale a folga social (fundo verde, sigla FP). */
function applyWeekendFpAsFolgaSocial(cells: ScheduleCellData[], year: number, month: number): void {
  for (let day = 1; day <= cells.length; day++) {
    const satIdx = day - 1;
    const satDate = new Date(year, month - 1, day);
    if (satDate.getDay() !== 6 || day >= cells.length) continue;

    const satCell = cells[satIdx];
    const domCell = cells[satIdx + 1];
    if (!isFpCell(satCell) || !isFpCell(domCell)) continue;

    const weekendFp: ScheduleCellData = {
      display: 'FP',
      kind: 'fp-weekend',
      title: 'Folga pedida (sáb+dom — folga social)',
    };
    cells[satIdx] = weekendFp;
    cells[satIdx + 1] = { ...weekendFp };
  }
}

function buildEmployeeRow(
  employee: Employee,
  year: number,
  month: number,
  days: number,
  assignmentMap: Map<string, ScheduleAssignmentRow>,
  operationalLabelMap: Map<string, string[]>,
): EmployeeRowData {
  const cells: ScheduleCellData[] = [];
  const summary = emptySummary();

  for (let day = 1; day <= days; day++) {
    const key = `${employee.id}|${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = resolveScheduleCell(
      sanitizeAssignmentForGrid(assignmentMap.get(key)),
      operationalLabelMap.get(key) ?? [],
    );
    cells.push(cell);
  }

  applyWeekendFpAsFolgaSocial(cells, year, month);

  for (const cell of cells) {
    countForSummary(cell, summary);
  }

  summary.folgaSocialOk = summary.folgaSocial >= 2;



  return {

    employeeId: employee.id,

    name: employee.name,

    type: employee.type,

    cells,

    summary,

  };

}



export interface BuildGridInput {
  year: number;
  month: number;
  employees: Employee[];
  assignments: ScheduleAssignmentRow[];
  preAllocations: PreAllocationRow[];
  operationalCadastros?: OperationalCadastroRow[];
}



function buildOperationalLabelMap(
  operationalCadastros: OperationalCadastroRow[] | undefined,
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const row of operationalCadastros ?? []) {
    const key = `${row.employeeId}|${dateKey(row.date)}`;
    const labels = map.get(key) ?? [];
    labels.push(row.label);
    map.set(key, labels);
  }
  return map;
}

/** ND e folgas geradas pelo motor vêm em preAllocations — não em operationalCadastros. */
function buildGeneratorPreallocLabelMap(
  preAllocations: PreAllocationRow[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const row of preAllocations) {
    if (!isGeneratorPreallocDisplayLabel(row.label)) continue;
    const key = `${row.employeeId}|${dateKey(row.date)}`;
    const labels = map.get(key) ?? [];
    labels.push(row.label);
    map.set(key, labels);
  }
  return map;
}

function mergeLabelMaps(
  primary: Map<string, string[]>,
  secondary: Map<string, string[]>,
): Map<string, string[]> {
  const merged = new Map(primary);
  for (const [key, labels] of secondary) {
    const existing = merged.get(key) ?? [];
    merged.set(key, [...existing, ...labels]);
  }
  return merged;
}

export function buildScheduleGrid(input: BuildGridInput): ScheduleGridData {
  const { year, month, employees, assignments, preAllocations, operationalCadastros } = input;
  const days = daysInMonth(year, month);
  const dayNumbers = Array.from({ length: days }, (_, i) => i + 1);

  const weekdayLabels = dayNumbers.map((d) => {
    const wd = new Date(year, month - 1, d).getDay();
    return WEEKDAYS[wd];
  });

  const assignmentMap = new Map<string, ScheduleAssignmentRow>();
  for (const a of assignments) {
    assignmentMap.set(`${a.employeeId}|${dateKey(a.date)}`, a);
  }

  const operationalLabelMap = mergeLabelMaps(
    buildOperationalLabelMap(operationalCadastros),
    buildGeneratorPreallocLabelMap(preAllocations),
  );

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
    const row = buildEmployeeRow(emp, year, month, days, assignmentMap, operationalLabelMap);
    if (emp.type === 'PAO') {
      paoRows.push(row);
    } else {
      apaoRows.push(row);
    }
  }



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

    groups,

  };

}



export function cellKindClass(kind: ScheduleCellKind): string {

  return kind === 'empty' ? 'cell-empty' : `cell-${kind}`;

}


