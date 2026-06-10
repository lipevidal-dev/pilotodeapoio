import type { EmployeeType } from './api.models';

/** Cor padrão única para todos os turnos (T6, T7, T8, T1–T4, etc.). */
export const SHIFT_DEFAULT_COLOR = {
  background: '#dbeafe',
  color: '#1e40af',
  border: '#93c5fd',
} as const;

export type ScheduleCellKind =
  | 'shift'
  | 't6'
  | 't7'
  | 't8'
  | 'nd'
  | 'folga'
  | 'fs'
  | 'fa'
  | 'fani'
  | 'fp'
  | 'fp-weekend'
  | 'ferias'
  | 'voo'
  | 'simulador'
  | 'curso'
  | 'cma'
  | 'outro'
  | 'empty'
  | 'other';

export interface ScheduleCellData {
  display: string;
  kind: ScheduleCellKind;
  title?: string;
}

export interface EmployeeSummaryStats {
  /** Auditoria interna */
  t6: number;
  t7: number;
  t8: number;
  nd: number;
  /** Resumo operacional principal */
  turnos: number;
  diasTrabalhados: number;
  folgas: number;
  folgaSocial: number;
  folgaSocialOk: boolean;
  fa: number;
  fani: number;
  fp: number;
  ferias: number;
  /** Dias livres para alocação de voo */
  vooDisp: number;
  /** @deprecated use vooDisp */
  disponivel: number;
  maxConsec: number;
  status: 'OK' | 'ATENÇÃO' | 'CRÍTICO';
  /** Regra principal que explica OK / ATENÇÃO / CRÍTICO (ex.: FOLGAS_PAO_ABOVE_MAX (12)). */
  statusReason: string | null;
  voos: number;
  simuladores: number;
  cursos: number;
  cma: number;
  outros: number;
}

export interface EmployeeRowData {
  employeeId: string;
  name: string;
  type: EmployeeType;
  cells: ScheduleCellData[];
  summary: EmployeeSummaryStats;
}

export interface ScheduleGridGroup {
  type: EmployeeType;
  label: string;
  rows: EmployeeRowData[];
}

export interface ScheduleGridData {
  year: number;
  month: number;
  daysInMonth: number;
  dayNumbers: number[];
  weekdayLabels: string[];
  groups: ScheduleGridGroup[];
}

/** Payload preparado para exportação futura (PDF/PNG/Excel). */
export interface ScheduleExportPayload {
  year: number;
  month: number;
  generatedAt: string;
  grid: ScheduleGridData;
  format: 'pdf' | 'png' | 'xlsx' | null;
}
