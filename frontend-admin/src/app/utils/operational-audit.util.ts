import type { ScheduleAssignmentRow } from '../models/api.models';
import type {
  EmployeeRowData,
  EmployeeSummaryStats,
  ScheduleCellData,
  ScheduleGridData,
} from '../models/schedule-grid.models';

export type OperationalStatus = 'OK' | 'ATENÇÃO' | 'CRÍTICO';
export type ViolationLevel = 'CRITICAL' | 'WARNING' | 'INFO';

export interface AuditViolation {
  severity: string;
  ruleCode: string;
  employee: string;
  employeeId?: string | null;
}

export type PaoCoverageShift = 'T6' | 'T7' | 'T8';

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
  /** Dia do mês → turnos PAO faltando naquele dia. */
  coverageGapDays: Record<number, PaoCoverageShift[]>;
}

export interface EmployeeOperationalEvaluation {
  status: OperationalStatus;
  statusReason: string | null;
}

/** Abaixo de 10 folgas (9 ou menos) = CRÍTICO. */
const MIN_PAO_FOLGAS = 10;
/** Até 12 folgas = faixa aceitável; 13+ = ATENÇÃO. */
const PAO_FOLGAS_OK_MAX = 12;
const MAX_CONSECUTIVE_WORK_DAYS = 6;

const MIN_APAO_FOLGAS_OK = 4;
const MIN_APAO_WORK_DAYS_OK = 24;

/** Faixa operacional saudável APAO — ignora monofolga e demais ATENÇÃO. */
function isApaoHealthyBand(stats: EmployeeSummaryStats): boolean {
  return stats.folgas >= MIN_APAO_FOLGAS_OK && stats.diasTrabalhados >= MIN_APAO_WORK_DAYS_OK;
}

/** Faixa operacional saudável PAO — status OK mesmo com 11–12 folgas. */
function isPaoHealthyBand(stats: EmployeeSummaryStats): boolean {
  return (
    stats.diasTrabalhados >= 18 &&
    stats.diasTrabalhados <= 21 &&
    stats.folgas >= 10 &&
    stats.folgas <= 12 &&
    stats.maxConsec < MAX_CONSECUTIVE_WORK_DAYS
  );
}

const CRITICAL_RULE_CODES = new Set([
  'COVERAGE_MISSING_T6',
  'COVERAGE_MISSING_T7',
  'COVERAGE_MISSING_T8',
  'FURO COBERTURA PAO',
  'COBERTURA PAO INCOMPLETA',
  'APAO SEM PAO',
  'SEM APAO DISPONÍVEL',
  'FA APAO DUPLICADA',
  'TRABALHO EM FÉRIAS',
  'TRABALHO EM DIA BLOQUEADO',
  'MAIS DE 2 SIMULTÂNEOS',
  'DESCANSO MENOR QUE 12H',
  'T8 SEM ND',
  'T8 ISOLADO',
  'TURNO NÃO PERMITIDO PARA PAO',
  'TURNO APAO COBERTO POR PAO REGULAR',
  'ND FORA DE T8/T8',
  'TURNO EM DIA ND',
]);

const WARNING_RULE_CODES = new Set([
  'MAIS DE 6 DIAS',
  'APAO SEM FOLGA 6x1',
  'MONOFOLGA',
  'FOLGAS PEDIDAS',
  'SEM FOLGA SOCIAL',
  'FOLGAS PAO',
  'RESTRIÇÃO VOO MÊS INTEIRO',
]);

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

/** Folgas que compõem bloco (não monofolga quando adjacentes). */
function isMonofolgaRestCell(cell: ScheduleCellData): boolean {
  return ['folga', 'fp', 'fp-weekend', 'fs', 'fa', 'fani'].includes(cell.kind);
}

/** Folga isolada: sem folga no dia anterior nem no seguinte. */
export function hasMonofolgaFromCells(
  cells: ScheduleCellData[],
  year: number,
  month: number,
): boolean {
  const restDays: number[] = [];
  cells.forEach((cell, idx) => {
    if (isMonofolgaRestCell(cell)) restDays.push(idx + 1);
  });
  if (restDays.length === 0) return false;

  const restSet = new Set(restDays);
  for (const day of restDays) {
    const prev = new Date(year, month - 1, day - 1);
    const next = new Date(year, month - 1, day + 1);
    const prevNum = prev.getMonth() === month - 1 ? prev.getDate() : -1;
    const nextNum = next.getMonth() === month - 1 ? next.getDate() : -1;
    if (!restSet.has(prevNum) && !restSet.has(nextNum)) {
      return true;
    }
  }
  return false;
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

function normalizeViolationSeverity(severity: string | undefined): ViolationLevel {
  const u = (severity ?? '').toUpperCase();
  if (u === 'CRITICAL' || u === 'CRÍTICA' || u === 'ALTA') return 'CRITICAL';
  if (u === 'WARNING' || u === 'MÉDIA' || u === 'MEDIA') return 'WARNING';
  return 'INFO';
}

/** Alinha com backend violation-level.ts — ruleCode tem prioridade sobre severity legado. */
export function classifyAuditViolation(violation: AuditViolation): ViolationLevel {
  const code = violation.ruleCode;
  if (CRITICAL_RULE_CODES.has(code)) return 'CRITICAL';
  if (WARNING_RULE_CODES.has(code)) return 'WARNING';
  return normalizeViolationSeverity(violation.severity);
}

function formatRuleCode(ruleCode: string): string {
  return ruleCode.trim().replace(/\s+/g, '_').toUpperCase();
}

function isMonofolgaViolation(v: AuditViolation): boolean {
  return formatRuleCode(v.ruleCode) === 'MONOFOLGA';
}

/** Alertas de escala PAO que não devem afetar o status operacional do APAO. */
const APAO_IGNORED_WARNING_CODES = new Set([
  'MONOFOLGA',
  'FOLGAS_PEDIDAS',
  'FOLGAS_PAO',
  'SEM_FOLGA_SOCIAL',
]);

function isApaoIgnoredWarning(v: AuditViolation): boolean {
  return APAO_IGNORED_WARNING_CODES.has(formatRuleCode(v.ruleCode));
}

function isPaoAuditType(employeeType: string): boolean {
  return employeeType === 'PAO';
}

function violationReason(violation: AuditViolation): string {
  const code = formatRuleCode(violation.ruleCode);
  if (violation.ruleCode === 'MAIS DE 6 DIAS') {
    const match = /\d+/.exec(violation.ruleCode);
    void match;
    return 'MAX_CONSECUTIVE_DAYS';
  }
  return code;
}

function firstViolationByLevel(
  violations: AuditViolation[],
  level: ViolationLevel,
): AuditViolation | undefined {
  return violations.find((v) => classifyAuditViolation(v) === level);
}

export function evaluateEmployeeOperationalStatus(
  stats: EmployeeSummaryStats,
  employeeType: string,
  daysInMonth: number,
  violations: AuditViolation[],
  employeeId: string,
  employeeName: string,
  cells?: ScheduleCellData[],
  year?: number,
  month?: number,
): EmployeeOperationalEvaluation {
  const empV = violationsForRow(violations, employeeId, employeeName);
  const criticalViolation = firstViolationByLevel(empV, 'CRITICAL');
  const warningViolation = firstViolationByLevel(empV, 'WARNING');
  const hasCritical = criticalViolation != null;
  const hasMonofolgaViolation = empV.some(isMonofolgaViolation);
  const hasMonofolgaFromGrid =
    isPaoAuditType(employeeType) &&
    cells != null &&
    year != null &&
    month != null
      ? hasMonofolgaFromCells(cells, year, month)
      : hasMonofolgaViolation;
  const hasMonofolga = isPaoAuditType(employeeType) && hasMonofolgaFromGrid;
  const hasFolgasWarning =
    stats.folgas > PAO_FOLGAS_OK_MAX && empV.some((v) => v.ruleCode === 'FOLGAS PAO');
  const hasMaisDe6Dias = empV.some((v) => v.ruleCode === 'MAIS DE 6 DIAS');

  if (isPaoAuditType(employeeType)) {
    if (stats.folgas < MIN_PAO_FOLGAS) {
      return {
        status: 'CRÍTICO',
        statusReason: `FOLGAS_PAO_BELOW_MIN (${stats.folgas})`,
      };
    }
    if (hasCritical) {
      return {
        status: 'CRÍTICO',
        statusReason: violationReason(criticalViolation!),
      };
    }
    if (
      empV.some((v) =>
        ['ND FORA DE T8/T8', 'TURNO EM DIA ND', 'TRABALHO EM FÉRIAS'].includes(v.ruleCode),
      )
    ) {
      const hit = empV.find((v) =>
        ['ND FORA DE T8/T8', 'TURNO EM DIA ND', 'TRABALHO EM FÉRIAS'].includes(v.ruleCode),
      )!;
      return {
        status: 'CRÍTICO',
        statusReason: formatRuleCode(hit.ruleCode),
      };
    }
    if (isPaoHealthyBand(stats)) {
      return { status: 'OK', statusReason: null };
    }
    if (stats.folgas > PAO_FOLGAS_OK_MAX) {
      return {
        status: 'ATENÇÃO',
        statusReason: `FOLGAS_PAO_ABOVE_MAX (${stats.folgas})`,
      };
    }
    if (hasMonofolga) {
      return { status: 'ATENÇÃO', statusReason: 'MONOFOLGA' };
    }
    if (hasFolgasWarning) {
      return { status: 'ATENÇÃO', statusReason: 'FOLGAS_PAO' };
    }
    if (!stats.folgaSocialOk) {
      return { status: 'ATENÇÃO', statusReason: 'SEM_FOLGA_SOCIAL' };
    }
    if (stats.vooDisp >= Math.ceil(daysInMonth * 0.35)) {
      return { status: 'ATENÇÃO', statusReason: `VOO_DISP_HIGH (${stats.vooDisp})` };
    }
    if (stats.turnos < Math.max(12, daysInMonth - MIN_PAO_FOLGAS - 6)) {
      return { status: 'ATENÇÃO', statusReason: `TURNOS_BELOW_MIN (${stats.turnos})` };
    }
    if (hasMaisDe6Dias || stats.maxConsec > MAX_CONSECUTIVE_WORK_DAYS) {
      return {
        status: 'ATENÇÃO',
        statusReason: `MAX_CONSECUTIVE_DAYS (${stats.maxConsec})`,
      };
    }
    if (warningViolation) {
      return { status: 'ATENÇÃO', statusReason: violationReason(warningViolation) };
    }
    return { status: 'OK', statusReason: null };
  }

  if (!isPaoAuditType(employeeType)) {
    const apaoWarnings = empV.filter((v) => !isApaoIgnoredWarning(v));
    const apaoWarningViolation = firstViolationByLevel(apaoWarnings, 'WARNING');

    if (hasCritical) {
      return {
        status: 'CRÍTICO',
        statusReason: violationReason(criticalViolation!),
      };
    }
    if (stats.vooDisp > 0) {
      return {
        status: 'CRÍTICO',
        statusReason: `VOO_DISP_APAO (${stats.vooDisp})`,
      };
    }
    if (isApaoHealthyBand(stats)) {
      return { status: 'OK', statusReason: null };
    }
    if (stats.maxConsec > MAX_CONSECUTIVE_WORK_DAYS || hasMaisDe6Dias) {
      return {
        status: 'ATENÇÃO',
        statusReason: `MAX_CONSECUTIVE_DAYS (${stats.maxConsec})`,
      };
    }
    if (apaoWarningViolation) {
      return { status: 'ATENÇÃO', statusReason: violationReason(apaoWarningViolation) };
    }
    return { status: 'OK', statusReason: null };
  }

  if (hasCritical) {
    return {
      status: 'CRÍTICO',
      statusReason: violationReason(criticalViolation!),
    };
  }
  if (warningViolation && !isMonofolgaViolation(warningViolation)) {
    return { status: 'ATENÇÃO', statusReason: violationReason(warningViolation) };
  }
  return { status: 'OK', statusReason: null };
}

export function computeEmployeeStatus(
  stats: EmployeeSummaryStats,
  employeeType: string,
  daysInMonth: number,
  violations: AuditViolation[],
  employeeId: string,
  employeeName: string,
  cells?: ScheduleCellData[],
  year?: number,
  month?: number,
): OperationalStatus {
  return evaluateEmployeeOperationalStatus(
    stats,
    employeeType,
    daysInMonth,
    violations,
    employeeId,
    employeeName,
    cells,
    year,
    month,
  ).status;
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
  const evaluation = evaluateEmployeeOperationalStatus(
    { ...row.summary, maxConsec, vooDisp, status: 'OK', statusReason: null },
    employeeType,
    daysInMonth,
    violations,
    row.employeeId,
    row.name,
    row.cells,
    year,
    month,
  );
  return {
    ...row,
    summary: {
      ...row.summary,
      vooDisp,
      maxConsec,
      status: evaluation.status,
      statusReason: evaluation.statusReason,
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
      enrichRowAudit(
        row,
        row.type === 'PAO' ? 'PAO' : 'APAO',
        grid.year,
        grid.month,
        daysInMonth,
        violations,
      ),
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

function buildPaoCoverageByDay(
  assignments: ScheduleAssignmentRow[],
  paoIds: Set<string>,
): { t6: Set<number>; t7: Set<number>; t8: Set<number> } {
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
  return covered;
}

export function computeCoverageGapsByDay(
  daysInMonth: number,
  assignments: ScheduleAssignmentRow[],
  paoIds: Set<string>,
): Record<number, PaoCoverageShift[]> {
  if (daysInMonth === 0) return {};
  const covered = buildPaoCoverageByDay(assignments, paoIds);
  const gaps: Record<number, PaoCoverageShift[]> = {};
  for (let day = 1; day <= daysInMonth; day++) {
    const missing: PaoCoverageShift[] = [];
    if (!covered.t6.has(day)) missing.push('T6');
    if (!covered.t7.has(day)) missing.push('T7');
    if (!covered.t8.has(day)) missing.push('T8');
    if (missing.length > 0) gaps[day] = missing;
  }
  return gaps;
}

export function computeCoveragePercents(
  year: number,
  month: number,
  daysInMonth: number,
  assignments: ScheduleAssignmentRow[],
  paoIds: Set<string>,
): { t6: number; t7: number; t8: number } {
  void year;
  void month;
  if (daysInMonth === 0) return { t6: 0, t7: 0, t8: 0 };
  const covered = buildPaoCoverageByDay(assignments, paoIds);

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
  const coverageGapDays = computeCoverageGapsByDay(
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
    coverageGapDays,
  };
}

export function turnosTooltip(stats: EmployeeSummaryStats): string {
  return `T6: ${stats.t6} | T7: ${stats.t7} | T8: ${stats.t8}`;
}

export function statusDetailTooltip(stats: EmployeeSummaryStats): string {
  if (!stats.statusReason) {
    return stats.status;
  }
  return `Status: ${stats.status}\nMotivo: ${stats.statusReason}`;
}
