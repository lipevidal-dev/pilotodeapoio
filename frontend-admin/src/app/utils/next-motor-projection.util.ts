import type { Employee } from '../models/api.models';
import {
  resolveEmployeeDiasTrabalhados,
  resolveEmployeeEspacamento,
  resolveEmployeeFolgaSocial,
  resolveEmployeeFolgas,
  resolveEmployeeTurnoMeta,
  computeEmployeeMetaPlannedTotal,
} from './pao-shift-params.util';

export interface MotorProjectionInput {
  enabled: Record<string, boolean>;
  params: Record<string, number>;
  year: number;
  month: number;
  rateioShiftCodes?: string[];
}

export interface EmployeeMotorProjection {
  turnos: number | null;
  diasTrabalhados: number | null;
  voos: number | null;
  folgas: number | null;
  folgaSocial: number | null;
  hint: string | null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function estimateCycleWorkDays(
  days: number,
  workPerCycle: number,
  restPerCycle: number,
): number {
  const cycle = workPerCycle + restPerCycle;
  if (cycle <= 0) return 0;
  const fullCycles = Math.floor(days / cycle);
  const remainder = days % cycle;
  return fullCycles * workPerCycle + Math.min(remainder, workPerCycle);
}

function estimateCycleRestDays(
  days: number,
  workPerCycle: number,
  restPerCycle: number,
): number {
  const cycle = workPerCycle + restPerCycle;
  if (cycle <= 0) return 0;
  const fullCycles = Math.floor(days / cycle);
  const remainder = days % cycle;
  return fullCycles * restPerCycle + Math.max(0, remainder - workPerCycle);
}

function cargoCode(emp: Employee): string {
  return (emp.cargoCode ?? emp.type ?? '').toUpperCase();
}

function isPaoRole(emp: Employee): boolean {
  const code = cargoCode(emp);
  if (code === 'APAO') return false;
  return code === 'PAO' || code === 'PAO FCF' || code.startsWith('PAO');
}

function isApaoRole(emp: Employee): boolean {
  return cargoCode(emp) === 'APAO';
}

/** PAO com calendário sem voo cobrindo todo o mês de referência. */
export function isFullMonthNoFlight(emp: Employee, year: number, month: number): boolean {
  const dates = emp.noFlightDates;
  if (!dates?.length) return false;
  const dim = daysInMonth(year, month);
  const blocked = new Set(dates.map((d) => d.slice(0, 10)));
  for (let day = 1; day <= dim; day++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!blocked.has(key)) return false;
  }
  return true;
}

export function projectEmployeeMotor(
  emp: Employee,
  input: MotorProjectionInput,
  preferredShiftCode: string | null = null,
): EmployeeMotorProjection {
  const { enabled, params, year, month, rateioShiftCodes = [] } = input;
  const dim = daysInMonth(year, month);

  if (isApaoRole(emp)) {
    if (!enabled['apao_regime_6x1']) {
      return {
        turnos: null,
        diasTrabalhados: null,
        voos: null,
        folgas: null,
        folgaSocial: null,
        hint: null,
      };
    }
    const work = params['apao_dias_trabalhados_ciclo'] ?? 6;
    const rest = params['apao_folgas_ciclo'] ?? 1;
    const turnos = estimateCycleWorkDays(dim, work, rest);
    const folgas = enabled['apao_folga_agrupada']
      ? estimateCycleRestDays(dim, work, rest)
      : null;
    return {
      turnos,
      diasTrabalhados: turnos,
      voos: null,
      folgas,
      folgaSocial: null,
      hint: `ciclo ${work}+${rest}`,
    };
  }

  if (!isPaoRole(emp)) {
    return {
      turnos: null,
      diasTrabalhados: null,
      voos: null,
      folgas: null,
      folgaSocial: null,
      hint: null,
    };
  }

  const prefCode = preferredShiftCode?.toUpperCase() ?? null;

  const turnosDisplay = enabled['pao_meta_turnos']
    ? resolveEmployeeTurnoMeta(params, enabled, rateioShiftCodes, prefCode)
    : null;
  const dias = prefCode
    ? resolveEmployeeDiasTrabalhados(params, enabled, prefCode)
    : null;
  const folgas = prefCode ? resolveEmployeeFolgas(params, enabled, prefCode) : null;
  const folgaSocial = prefCode ? resolveEmployeeFolgaSocial(params, enabled, prefCode) : null;

  const hints: string[] = [];
  if (emp.isFcf) hints.push('FCF');

  const spacing = resolveEmployeeEspacamento(params, enabled, prefCode);
  if (spacing != null) hints.push(`espaço ${spacing}d entre turnos`);

  let voos: number | null = null;
  if (isFullMonthNoFlight(emp, year, month)) {
    hints.push('sem voos no mês');
    voos = 0;
  } else if (turnosDisplay != null && dias != null) {
    voos = Math.max(0, dias - turnosDisplay);
  }

  return {
    turnos: turnosDisplay,
    diasTrabalhados: dias,
    voos,
    folgas,
    folgaSocial,
    hint: hints.length ? hints.join(' · ') : null,
  };
}

export function formatEmployeeProjection(p: EmployeeMotorProjection): string {
  const parts: string[] = [];
  if (p.turnos != null) parts.push(`≈ ${p.turnos} turnos`);
  if (p.diasTrabalhados != null) parts.push(`≈ ${p.diasTrabalhados} dias`);
  if (p.voos != null) parts.push(p.voos > 0 ? `~${p.voos} voos` : '0 voos');
  if (p.folgas != null) parts.push(`≈ ${p.folgas} folgas`);
  if (p.folgaSocial != null && p.folgaSocial > 0) parts.push(`≈ ${p.folgaSocial} FS`);
  if (parts.length === 0) return '';
  return parts.join(' · ');
}

export interface ScopeProjectionSummary {
  paoCount: number;
  apaoCount: number;
  avgTurnos: number | null;
  avgDias: number | null;
  avgVoos: number | null;
  monthLabel: string;
}

export function buildScopeProjectionSummary(
  projections: Array<{ role: 'PAO' | 'APAO' | 'OTHER'; projection: EmployeeMotorProjection }>,
  year: number,
  month: number,
): ScopeProjectionSummary | null {
  const paos = projections.filter((x) => x.role === 'PAO');
  const apaos = projections.filter((x) => x.role === 'APAO');
  if (paos.length === 0 && apaos.length === 0) return null;

  const avg = (values: (number | null)[]): number | null => {
    const nums = values.filter((v): v is number => v != null);
    if (!nums.length) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  };

  const monthLabel = `${String(month).padStart(2, '0')}/${year}`;

  return {
    paoCount: paos.length,
    apaoCount: apaos.length,
    avgTurnos: avg(paos.map((p) => p.projection.turnos)),
    avgDias: avg(paos.map((p) => p.projection.diasTrabalhados)),
    avgVoos: avg(paos.map((p) => p.projection.voos)),
    monthLabel,
  };
}

export function formatScopeSummary(s: ScopeProjectionSummary): string {
  const chunks: string[] = [`Referência ${s.monthLabel}`];
  if (s.paoCount > 0) {
    const paoParts: string[] = [`${s.paoCount} PAO`];
    if (s.avgTurnos != null) paoParts.push(`méd. ${s.avgTurnos} turnos`);
    if (s.avgDias != null) paoParts.push(`méd. ${s.avgDias} dias`);
    if (s.avgVoos != null) paoParts.push(`méd. ${s.avgVoos} voos`);
    chunks.push(paoParts.join(' · '));
  }
  if (s.apaoCount > 0) {
    chunks.push(`${s.apaoCount} APAO no escopo`);
  }
  return chunks.join(' — ');
}
