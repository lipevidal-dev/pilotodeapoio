import type { Shift } from '../models/api.models';
import type {
  EmployeeRowData,
  ScheduleCellData,
  ScheduleGridData,
} from '../models/schedule-grid.models';
import { baseShiftCode } from './instruction-shift.util';

export type ApaoRestAlertKind = 'SHIFT_REST_11H' | 'POST_DAY_OFF_36H';

export interface ApaoRestViolation {
  kind: ApaoRestAlertKind;
  employeeId: string;
  employeeName: string;
  previousDate: string;
  nextDate: string;
  previousShift: string;
  nextShift: string;
  restHours: number;
}

export interface ApaoRestAlert {
  kind: ApaoRestAlertKind;
  count: number;
  iconSrc: string;
  label: string;
  tooltip: string;
  violations: ApaoRestViolation[];
}

interface DatedCell {
  isoDate: string;
  inCurrentMonth: boolean;
  cell: ScheduleCellData;
}

interface ShiftPeriod {
  code: string;
  startAt: number;
  endAt: number;
}

const DAY_OFF_KINDS = new Set([
  'folga',
  'folga-weekend',
  'fs',
  'fa',
  'fani',
  'fp',
  'fp-weekend',
]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function utcDay(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

function timestampAt(isoDate: string, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return utcDay(isoDate) + (hours! * 60 + minutes!) * 60 * 1000;
}

function isNextDay(first: string, second: string): boolean {
  return utcDay(second) - utcDay(first) === DAY_MS;
}

function shiftForCell(
  dated: DatedCell,
  shiftsByCode: ReadonlyMap<string, Shift>,
): ShiftPeriod | null {
  const code = baseShiftCode(dated.cell.display).toUpperCase();
  const shift = shiftsByCode.get(code);
  if (!shift) return null;

  const startAt = timestampAt(dated.isoDate, shift.startTime);
  let endAt = timestampAt(dated.isoDate, shift.endTime);
  if (endAt <= startAt) endAt += DAY_MS;
  return { code, startAt, endAt };
}

function rowCells(grid: ScheduleGridData, row: EmployeeRowData): DatedCell[] {
  return grid.columns
    .map((column): DatedCell => ({
      isoDate: column.isoDate,
      inCurrentMonth: !column.isLead,
      cell: column.isLead
        ? (row.leadCells?.[column.leadIndex] ?? { display: '', kind: 'empty' })
        : (row.cells[column.day - 1] ?? { display: '', kind: 'empty' }),
    }))
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

function roundedHours(milliseconds: number): number {
  return Math.round((milliseconds / HOUR_MS) * 10) / 10;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace('.', ',');
}

function tooltipFor(
  kind: ApaoRestAlertKind,
  violations: ApaoRestViolation[],
): string {
  const heading =
    kind === 'SHIFT_REST_11H'
      ? `Descanso menor que 11 horas entre turnos (${violations.length})`
      : `Descanso menor que 36 horas após turno + folga (${violations.length})`;
  const lines = violations.slice(0, 8).map(
    (violation) =>
      `${violation.employeeName}: ${formatDate(violation.previousDate)} ${violation.previousShift} → ` +
      `${formatDate(violation.nextDate)} ${violation.nextShift} ` +
      `(${formatHours(violation.restHours)}h de descanso)`,
  );
  if (violations.length > lines.length) {
    lines.push(`+ ${violations.length - lines.length} outro(s) alerta(s)`);
  }
  return [heading, ...lines].join('\n');
}

function toAlert(
  kind: ApaoRestAlertKind,
  violations: ApaoRestViolation[],
): ApaoRestAlert | null {
  if (!violations.length) return null;
  const shiftRest = kind === 'SHIFT_REST_11H';
  return {
    kind,
    count: violations.length,
    iconSrc: shiftRest
      ? 'assets/icons/coverage-attention.svg'
      : 'assets/icons/coverage-attention-warning.svg',
    label: shiftRest ? 'Descanso entre turnos menor que 11 horas' : 'Descanso pós-folga menor que 36 horas',
    tooltip: tooltipFor(kind, violations),
    violations,
  };
}

/** Alertas do próximo turno, opcionalmente de um colaborador. */
export function apaoRestAlertsForTarget(
  alerts: readonly ApaoRestAlert[],
  isoDate: string,
  employeeId?: string,
): ApaoRestAlert[] {
  return alerts
    .map((alert) =>
      toAlert(
        alert.kind,
        alert.violations.filter(
          (violation) =>
            violation.nextDate === isoDate &&
            (employeeId === undefined || violation.employeeId === employeeId),
        ),
      ),
    )
    .filter((alert): alert is ApaoRestAlert => alert !== null);
}

/** Agrupa os alertas no dia do próximo turno — a coluna em que o descanso falhou. */
export function groupApaoRestAlertsByDate(
  alerts: readonly ApaoRestAlert[],
): ReadonlyMap<string, ApaoRestAlert[]> {
  const violationsByDate = new Map<string, Map<ApaoRestAlertKind, ApaoRestViolation[]>>();

  for (const alert of alerts) {
    for (const violation of alert.violations) {
      const byKind = violationsByDate.get(violation.nextDate) ?? new Map();
      const list = byKind.get(violation.kind) ?? [];
      list.push(violation);
      byKind.set(violation.kind, list);
      violationsByDate.set(violation.nextDate, byKind);
    }
  }

  const result = new Map<string, ApaoRestAlert[]>();
  for (const [isoDate, byKind] of violationsByDate) {
    result.set(
      isoDate,
      [
        toAlert('SHIFT_REST_11H', byKind.get('SHIFT_REST_11H') ?? []),
        toAlert('POST_DAY_OFF_36H', byKind.get('POST_DAY_OFF_36H') ?? []),
      ].filter((alert): alert is ApaoRestAlert => alert !== null),
    );
  }
  return result;
}

/**
 * Auditoria visual exclusiva de APAO.
 *
 * Não bloqueia nem altera alocações. O ícone vai na coluna do próximo turno:
 * - menos de 11h entre turnos em dias consecutivos;
 * - menos de 36h entre o fim de um turno e o próximo turno quando há folga no dia intermediário.
 */
export function computeApaoRestAlerts(
  grid: ScheduleGridData | null,
  shifts: Shift[],
): ApaoRestAlert[] {
  if (!grid) return [];

  const shiftsByCode = new Map(shifts.map((shift) => [shift.code.toUpperCase(), shift]));
  const shiftRestViolations: ApaoRestViolation[] = [];
  const postDayOffViolations: ApaoRestViolation[] = [];

  for (const group of grid.groups) {
    if (String(group.type).toUpperCase() !== 'APAO') continue;

    for (const row of group.rows) {
      const cells = rowCells(grid, row);
      for (let index = 0; index < cells.length; index++) {
        const previous = cells[index];
        if (!previous) continue;
        const previousShift = shiftForCell(previous, shiftsByCode);
        if (!previousShift) continue;

        const next = cells[index + 1];
        if (next && next.inCurrentMonth && isNextDay(previous.isoDate, next.isoDate)) {
          const nextShift = shiftForCell(next, shiftsByCode);
          if (nextShift) {
            const restHours = roundedHours(nextShift.startAt - previousShift.endAt);
            if (restHours < 11) {
              shiftRestViolations.push({
                kind: 'SHIFT_REST_11H',
                employeeId: row.employeeId,
                employeeName: row.name,
                previousDate: previous.isoDate,
                nextDate: next.isoDate,
                previousShift: previousShift.code,
                nextShift: nextShift.code,
                restHours,
              });
            }
          }
        }

        const dayOff = cells[index + 1];
        const afterDayOff = cells[index + 2];
        if (
          !dayOff ||
          !afterDayOff ||
          !afterDayOff.inCurrentMonth ||
          !isNextDay(previous.isoDate, dayOff.isoDate) ||
          !isNextDay(dayOff.isoDate, afterDayOff.isoDate) ||
          !DAY_OFF_KINDS.has(dayOff.cell.kind)
        ) {
          continue;
        }

        const nextShift = shiftForCell(afterDayOff, shiftsByCode);
        if (!nextShift) continue;
        const restHours = roundedHours(nextShift.startAt - previousShift.endAt);
        if (restHours < 36) {
          postDayOffViolations.push({
            kind: 'POST_DAY_OFF_36H',
            employeeId: row.employeeId,
            employeeName: row.name,
            previousDate: previous.isoDate,
            nextDate: afterDayOff.isoDate,
            previousShift: previousShift.code,
            nextShift: nextShift.code,
            restHours,
          });
        }
      }
    }
  }

  return [
    toAlert('SHIFT_REST_11H', shiftRestViolations),
    toAlert('POST_DAY_OFF_36H', postDayOffViolations),
  ].filter((alert): alert is ApaoRestAlert => alert !== null);
}
