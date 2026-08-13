import type { EmployeeType } from './api.models';

/** Cor padrão única para todos os turnos (T6, T7, T8, T1–T4, etc.). */
export const SHIFT_DEFAULT_COLOR = {
  background: '#dbeafe',
  color: '#1e40af',
  border: '#93c5fd',
} as const;

export type ScheduleCellKind =
  | 'shift'
  | 'instruction-shift'
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
  | 'folga-weekend'
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
  /** Tipo original quando kind é folga-weekend (cor de folga social no sáb+dom). */
  folgaBaseKind?: ScheduleCellKind;
  /** Solicitação aguardando aprovação do admin. */
  requestPending?: boolean;
  /** ID da solicitação pendente (RequestedDayOff, PreAllocation ou Flight). */
  requestId?: string;
  /** Troca de turno ativa (oferta ou aguardando admin). */
  shiftSwap?: {
    id: string;
    status: 'OFFERED' | 'AWAITING_ADMIN';
    role: 'requester' | 'target';
    counterpartName: string;
    counterpartShiftCode: string;
    /** Código do turno nesta célula (lado do colaborador da linha). */
    ownShiftCode?: string;
    requesterName?: string;
    targetName?: string;
    requesterShiftCode?: string;
    targetShiftCode?: string;
    /** Dia do solicitante (ISO). */
    sourceDate?: string;
    /** Dia do colega / destino (ISO). */
    targetDate?: string | null;
    /** Índice de cor do par (0 = vermelho, 1 = azul, …). */
    colorIndex?: number;
  };
  /** Destaque local: dia selecionado como origem da troca (ainda sem oferta). */
  swapSelected?: boolean;
  /** Turno já trocado e aprovado (canto vermelho discreto). */
  swapApplied?: boolean;
  /** @deprecated use hoverDetail */
  title?: string;
  /** Texto do popup após ~1s com mouse sobre a célula (somente hover, não clique). */
  hoverDetail?: string;
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
  /** Células do mês corrente (índice = dia - 1). */
  cells: ScheduleCellData[];
  /**
   * Últimos dias do mês anterior (contexto visual em escala não publicada).
   * Índice alinhado a `ScheduleDayColumn.leadIndex` das colunas com `isLead`.
   */
  leadCells?: ScheduleCellData[];
  summary: EmployeeSummaryStats;
  /** Preferência de turno do portal no mês (ex.: T6). Só preenchido para admin na Escala. */
  preferredShiftCode?: string;
}

export interface ScheduleGridGroup {
  type: EmployeeType;
  label: string;
  rows: EmployeeRowData[];
}

/** Coluna de dia na grade (mês atual e, opcionalmente, lead-in do mês anterior). */
export interface ScheduleDayColumn {
  /** Chave estável YYYY-MM-DD. */
  isoDate: string;
  day: number;
  year: number;
  month: number;
  weekdayLabel: string;
  isWeekend: boolean;
  /** Dia do mês anterior (somente leitura / contexto). */
  isLead: boolean;
  /** Primeiro dia do mês corrente — usado para a linha divisória. */
  isMonthStart: boolean;
  /** Índice em `EmployeeRowData.leadCells` quando `isLead`. */
  leadIndex: number;
}

export interface ScheduleGridData {
  year: number;
  month: number;
  daysInMonth: number;
  /** Dias do mês corrente (1..N) — seleção, cobertura e export. */
  dayNumbers: number[];
  weekdayLabels: string[];
  /** Colunas exibidas (lead-in + mês corrente). */
  columns: ScheduleDayColumn[];
  /** Quantidade de colunas lead-in (0 quando publicada / sem contexto). */
  leadDayCount: number;
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
