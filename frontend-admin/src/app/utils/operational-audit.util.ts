import type { ScheduleAssignmentRow } from '../models/api.models';
import type {
  EmployeeRowData,
  EmployeeSummaryStats,
  ScheduleCellData,
  ScheduleGridData,
} from '../models/schedule-grid.models';

export type OperationalStatus = 'OK' | 'ATENÇÃO' | 'CRÍTICO';

export interface AuditViolation {
  severity: string;
  ruleCode: string;
  employee: string;
  employeeId?: string | null;
}

export interface GridAuditTotals {
  totalPaos: number;
  totalApaos: number;
  totalTurnos: number;
  totalDiasTrabalhados: number;
  totalFolgas: number;
  totalFolgaSocial: number;
  totalFp: number;
  totalFani: number;
  totalFerias: number;
  totalVoos: number;
  totalVooDisp: number;
  coverageT6: number;
  coverageT7: number;
  coverageT8: number;
}

const MIN_PAO_FOLGAS = 10;
const MAX_PAO_FOLGAS = 11;

function isWorkDay(cell: ScheduleCellData): boolean {
  switch (cell.kind) {
    case 'shift':
    case 't6':
    case 't7':
    case 't8':
    case 'nd':
    case 'voo':
    case 'simulador':
    case 'curso':
    case 'cma':
    case 'outro':
      return true;
    default:
      return false;
  }
}

function isFullyFreeDay(cell: ScheduleCellData): boolean {
  return cell.kind === 'empty';
}

/** Maior sequência consecutiva de dias trabalhados no mês. */
export function maxConsecutiveWorkDays(cells: ScheduleCellData[], year: number, month: number): number {
  const workDays: number[] = [];
  cells.forEach((cell, idx) => {
    if (isWorkDay(cell)) workDays.push(idx + 1);
  });
  if (workDays.length === 0) return 0;

  let max = 1;
  let streak = 1;
  for (let i = 1; i < workDays.length; i++) {
    const prev = new Date(year, month - 1, workDays[i - 1]);
    const cur = new Date(year, month - 1, workDays[i]);
    const diff = (cur.getTime() - prev.getTime()) / 86_400_000;
    if (diff === 1) {
      streak++;
      max = Math.max(max, streak);
    } else {
      streak = 1;
    }
  }
  return max;
}

function violationsForRow(
  violations: AuditViolation[],
  employeeId: string,
  employeeName: string,
): AuditViolation[] {
  return violations.filter(
    (v) =>
      v.employee === employeeName ||
      (v.employeeId != null && v.employeeId === employeeId),
  );
}

export function computeEmployeeStatus(
  stats: EmployeeSummaryStats,
  employeeType: string,
  daysInMonth: number,
  violations: AuditViolation[],
  employeeId: string,
  employeeName: string,
): OperationalStatus {
  const empV = violationsForRow(violations, employeeId, employeeName);
  const hasCritical = empV.some((v) => v.severity === 'CRITICAL');
  const hasMonofolga = empV.some((v) => v.ruleCode === 'MONOFOLGA');
  const hasFolgasWarning = empV.some((v) => v.ruleCode === 'FOLGAS PAO');

  if (employeeType === 'PAO') {
    if (stats.folgas < MIN_PAO_FOLGAS || stats.folgas > MAX_PAO_FOLGAS) return 'CRÍTICO';
    if (hasCritical) return 'CRÍTICO';
    if (
      empV.some((v) =>
        ['ND FORA DE T8/T8', 'TURNO EM DIA ND', 'TRABALHO EM FÉRIAS'].includes(v.ruleCode),
      )
    ) {
      return 'CRÍTICO';
    }
    if (
      stats.folgas === MAX_PAO_FOLGAS ||
      hasMonofolga ||
      hasFolgasWarning ||
      !stats.folgaSocialOk ||
      stats.vooDisp >= Math.ceil(daysInMonth * 0.35) ||
      stats.turnos < Math.max(12, daysInMonth - MIN_PAO_FOLGAS - 6)
    ) {
      return 'ATENÇÃO';
    }
    return 'OK';
  }

  if (employeeType === 'APAO') {
    if (hasCritical) return 'CRÍTICO';
    if (stats.vooDisp > 0) return 'CRÍTICO';
    if (stats.maxConsec > 6 || hasMonofolga) return 'ATENÇÃO';
    return 'OK';
  }

  if (hasCritical) return 'CRÍTICO';
  if (hasMonofolga) return 'ATENÇÃO';
  return 'OK';
}

export function enrichRowAudit(
  row: EmployeeRowData,
  employeeType: string,
  year: number,
  month: number,
  daysInMonth: number,
  violations: AuditViolation[],
): EmployeeRowData {
  const maxConsec = maxConsecutiveWorkDays(row.cells, year, month);
  const vooDisp = row.cells.filter((c) => isFullyFreeDay(c)).length;
  const status = computeEmployeeStatus(
    { ...row.summary, maxConsec, vooDisp, status: 'OK' },
    employeeType,
    daysInMonth,
    violations,
    row.employeeId,
    row.name,
  );
  return {
    ...row,
    summary: {
      ...row.summary,
      vooDisp,
      maxConsec,
      status,
    },
  };
}

export function enrichGridAudit(
  grid: ScheduleGridData,
  violations: AuditViolation[] = [],
): ScheduleGridData {
  const daysInMonth = grid.daysInMonth;
  const groups = grid.groups.map((g) => ({
    ...g,
    rows: g.rows.map((row) =>
      enrichRowAudit(row, g.type, grid.year, grid.month, daysInMonth, violations),
    ),
  }));
  return { ...grid, groups };
}

function dateKeyFromAssignment(dateIso: string): string {
  const d = new Date(dateIso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeCoveragePercents(
  year: number,
  month: number,
  daysInMonth: number,
  assignments: ScheduleAssignmentRow[],
  paoIds: Set<string>,
): { t6: number; t7: number; t8: number } {
  if (daysInMonth === 0) return { t6: 0, t7: 0, t8: 0 };
  const covered = { t6: new Set<number>(), t7: new Set<number>(), t8: new Set<number>() };

  for (const a of assignments) {
    if (!paoIds.has(a.employeeId)) continue;
    const key = dateKeyFromAssignment(a.date);
    const [, , dayStr] = key.split('-');
    const day = Number(dayStr);
    const code = (a.shiftCode ?? '').toUpperCase();
    if (code === 'T6') covered.t6.add(day);
    if (code === 'T7') covered.t7.add(day);
    if (code === 'T8') covered.t8.add(day);
  }

  const pct = (n: number) => Math.round((n / daysInMonth) * 100);
  return {
    t6: pct(covered.t6.size),
    t7: pct(covered.t7.size),
    t8: pct(covered.t8.size),
  };
}

export function computeGridAuditTotals(
  grid: ScheduleGridData,
  assignments: ScheduleAssignmentRow[] = [],
): GridAuditTotals {
  let totalTurnos = 0;
  let totalDiasTrabalhados = 0;
  let totalFolgas = 0;
  let totalFolgaSocial = 0;
  let totalFp = 0;
  let totalFani = 0;
  let totalFerias = 0;
  let totalVoos = 0;
  let totalVooDisp = 0;
  let totalPaos = 0;
  let totalApaos = 0;

  for (const g of grid.groups) {
    if (g.type === 'PAO') totalPaos += g.rows.length;
    if (g.type === 'APAO') totalApaos += g.rows.length;
    for (const row of g.rows) {
      const s = row.summary;
      totalTurnos += s.turnos;
      totalDiasTrabalhados += s.diasTrabalhados;
      totalFolgas += s.folgas;
      totalFolgaSocial += s.folgaSocial;
      totalFp += s.fp;
      totalFani += s.fani;
      totalFerias += s.ferias;
      totalVoos += s.voos;
      totalVooDisp += s.vooDisp;
    }
  }

  const paoIds = new Set<string>();
  for (const g of grid.groups) {
    if (g.type === 'PAO') {
      for (const row of g.rows) paoIds.add(row.employeeId);
    }
  }
  const coverage = computeCoveragePercents(
    grid.year,
    grid.month,
    grid.daysInMonth,
    assignments,
    paoIds,
  );

  return {
    totalPaos,
    totalApaos,
    totalTurnos,
    totalDiasTrabalhados,
    totalFolgas,
    totalFolgaSocial,
    totalFp,
    totalFani,
    totalFerias,
    totalVoos,
    totalVooDisp,
    coverageT6: coverage.t6,
    coverageT7: coverage.t7,
    coverageT8: coverage.t8,
  };
}

export function turnosTooltip(stats: EmployeeSummaryStats): string {
  return `T6: ${stats.t6} | T7: ${stats.t7} | T8: ${stats.t8}`;
}
