import type {
  Employee,
  ScheduleMonthResponse,
} from '../models/api.models';
import type { MotorProjectionInput } from './next-motor-projection.util';
import { apiDateKey } from './employee-occupancy.util';
import { resolveEmployeeTurnoMeta, computeEmployeeMetaPlannedTotal } from './pao-shift-params.util';

export interface PaoDayBudgetPreCommitted {
  total: number;
  preAllocations: number;
  requestedOff: number;
  vacations: number;
  assignments: number;
}

export interface PaoDayBudgetMetaPlanned {
  total: number;
  turnos: number;
  folgas: number;
  folgaSocial: number;
}

export interface PaoDayBudget {
  totalDays: number;
  monthLabel: string;
  employeeId: string;
  employeeName: string;
  preCommitted: PaoDayBudgetPreCommitted;
  metaPlanned: PaoDayBudgetMetaPlanned;
  /** Dias ainda disponíveis no mês após pré-alocações/folgas fixas e metas configuradas. */
  remaining: number;
  overBudget: boolean;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function inMonth(key: string, prefix: string): boolean {
  return key.startsWith(prefix);
}

function isPaoEmployee(emp: Employee): boolean {
  const code = (emp.cargoCode ?? emp.type ?? '').toUpperCase();
  if (code === 'APAO') return false;
  return code === 'PAO' || code === 'PAO FCF' || code.startsWith('PAO');
}

/** Conta dias únicos já ocupados no mês (pré-aloc, FP, férias, geração anterior). */
export function countEmployeePreCommittedDays(
  employeeId: string,
  year: number,
  month: number,
  schedule: ScheduleMonthResponse | null,
): PaoDayBudgetPreCommitted {
  const prefix = monthPrefix(year, month);
  const all = new Set<string>();
  const preAllocations = new Set<string>();
  const requestedOff = new Set<string>();
  const vacations = new Set<string>();
  const assignments = new Set<string>();

  const mark = (key: string, bucket: Set<string>) => {
    if (!inMonth(key, prefix)) return;
    all.add(key);
    bucket.add(key);
  };

  for (const row of schedule?.operationalCadastros ?? []) {
    if (row.employeeId !== employeeId) continue;
    const key = apiDateKey(row.date);
    if (row.source === 'requested_day_off') mark(key, requestedOff);
    else if (row.source === 'vacation') mark(key, vacations);
    else if (row.source === 'pre_allocation') mark(key, preAllocations);
    else if (row.source === 'flight') mark(key, assignments);
    else {
      if (inMonth(key, prefix)) all.add(key);
    }
  }

  for (const row of schedule?.preAllocations ?? []) {
    if (row.employeeId !== employeeId) continue;
    mark(apiDateKey(row.date), preAllocations);
  }

  for (const row of schedule?.assignments ?? []) {
    if (row.employeeId !== employeeId) continue;
    mark(apiDateKey(row.date), assignments);
  }

  return {
    total: all.size,
    preAllocations: preAllocations.size,
    requestedOff: requestedOff.size,
    vacations: vacations.size,
    assignments: assignments.size,
  };
}

export function computePaoMetaPlanned(
  input: MotorProjectionInput,
  preferredShiftCode: string | null = null,
): PaoDayBudgetMetaPlanned {
  const { enabled, params, rateioShiftCodes = [] } = input;
  const planned = computeEmployeeMetaPlannedTotal(
    params,
    enabled,
    rateioShiftCodes,
    preferredShiftCode?.toUpperCase() ?? null,
  );
  return {
    total: planned.total,
    turnos: planned.turnos,
    folgas: planned.folgas,
    folgaSocial: planned.folgaSocial,
  };
}

export function computePaoDayBudget(
  emp: Employee,
  input: MotorProjectionInput,
  schedule: ScheduleMonthResponse | null,
  preferredShiftCode: string | null = null,
): PaoDayBudget | null {
  if (!isPaoEmployee(emp)) return null;

  const { year, month } = input;
  const totalDays = daysInMonth(year, month);
  const preCommitted = countEmployeePreCommittedDays(emp.id, year, month, schedule);
  const metaPlanned = computePaoMetaPlanned(input, preferredShiftCode);
  const remaining = totalDays - preCommitted.total - metaPlanned.total;

  return {
    totalDays,
    monthLabel: `${String(month).padStart(2, '0')}/${year}`,
    employeeId: emp.id,
    employeeName: emp.name,
    preCommitted,
    metaPlanned,
    remaining,
    overBudget: remaining < 0,
  };
}

export function formatPaoDayBudgetSummary(b: PaoDayBudget): string {
  const parts = [
    `${b.totalDays} dias no mês`,
    `${b.preCommitted.total} já fixos`,
    `${b.metaPlanned.total} nas metas`,
    b.overBudget
      ? `${Math.abs(b.remaining)} dia(s) acima do limite`
      : `${b.remaining} livre(s)`,
  ];
  return parts.join(' · ');
}

export interface PaoDayBudgetCompact {
  monthLabel: string;
  totalDays: number;
  fixedDays: number;
  metaDays: number;
  remaining: number;
  overBudget: boolean;
  fixedPct: number;
  metaPct: number;
  freePct: number;
}

export function toPaoDayBudgetCompact(b: PaoDayBudget): PaoDayBudgetCompact {
  const fixedPct = Math.min(100, (b.preCommitted.total / b.totalDays) * 100);
  const metaPct = Math.min(100 - fixedPct, (b.metaPlanned.total / b.totalDays) * 100);
  const freePct = Math.max(0, 100 - fixedPct - metaPct);
  return {
    monthLabel: b.monthLabel,
    totalDays: b.totalDays,
    fixedDays: b.preCommitted.total,
    metaDays: b.metaPlanned.total,
    remaining: b.remaining,
    overBudget: b.overBudget,
    fixedPct,
    metaPct,
    freePct,
  };
}
