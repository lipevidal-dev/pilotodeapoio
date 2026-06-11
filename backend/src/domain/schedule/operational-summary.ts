import { IDEAL_PAO_REST_COUNT, PAO_REST_TYPES } from "../rules/constants.js";
import {
  evaluateEmployeeOperationalStatus,
  coveragePercentages,
  workDatesFromWorkspace,
  maxConsecutiveWorkDays,
  type OperationalStatus,
} from "./operational-audit.js";
import { listAvailableForFlightFromWorkspace } from "./available-for-flight.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import { listPaoRateioShiftCodesFromWorkspace } from "./pao-rateio-shifts.js";
import type { ScheduleContext, ValidationIssue } from "./types.js";
import { assignmentKey } from "./types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

export type { OperationalStatus };

function paoTurnoCodes(ws: GenerationWorkspace): Set<string> {
  return new Set(listPaoRateioShiftCodesFromWorkspace(ws));
}

export interface EmployeeOperationalSummary {
  employeeUuid: string;
  name: string;
  type: string;
  turnos: number;
  /** Turnos alocados para rateio (inclui PARALLEL). */
  assignedShiftCount: number;
  diasTrabalhados: number;
  /** F + FS + FA + FP (folgas computáveis) */
  folgas: number;
  folgaSocial: number;
  /** Sim ou Não (PAO) / contagem FA (APAO no frontend) */
  folgaSocialOk: boolean;
  fa: number;
  fani: number;
  fp: number;
  ferias: number;
  disponivel: number;
  availableForFlight: string[];
  /** Auditoria interna */
  t6: number;
  t7: number;
  t8: number;
  nd: number;
  voos: number;
  simuladores: number;
  cursos: number;
  cma: number;
  outros: number;
  /** Folgas além do ideal (11) */
  folgasAjusteOperacional: boolean;
  /** Maior sequência consecutiva de dias trabalhados */
  maxConsec: number;
  status: OperationalStatus;
  statusReason: string | null;
}

export interface OperationalTotals {
  totalPaos: number;
  totalApaos: number;
  totalTurnos: number;
  totalDiasTrabalhados: number;
  totalFolgas: number;
  totalFolgaSocial: number;
  totalFp: number;
  totalFani: number;
  totalFerias: number;
  totalDisponiveis: number;
  totalVoos: number;
  totalSimuladores: number;
  totalCursos: number;
  totalNd: number;
  totalCma: number;
  totalOutros: number;
  coverageT6: number;
  coverageT7: number;
  coverageT8: number;
}

export interface OperationalSummaryResult {
  byEmployee: EmployeeOperationalSummary[];
  totals: OperationalTotals;
  mathClosureOk: boolean;
  mathClosureErrors: string[];
}

function apaoTurnoCodes(ws: GenerationWorkspace): Set<string> {
  const codes = new Set<string>();
  for (const s of ws.input.shifts) {
    if (s.active !== false && (s.role === "APAO" || s.role === "BOTH")) {
      codes.add(s.code.toUpperCase());
    }
  }
  if (codes.size === 0) {
    for (const [code, info] of Object.entries(ws.shiftMap)) {
      if (info.role === "APAO" || info.role === "BOTH") codes.add(code.toUpperCase());
    }
  }
  if (codes.size === 0) ["T1", "T2", "T3", "T4"].forEach((c) => codes.add(c));
  return codes;
}

function isFeriasLabel(label: string): boolean {
  const u = normalizeOperationalLabel(label).toUpperCase();
  return u === "FÉRIAS" || u === "FERIAS";
}

function isFpLabel(label: string): boolean {
  const u = normalizeOperationalLabel(label).toUpperCase();
  return u === "FOLGA PEDIDA" || u === "FOLGA ESCOLHIDA";
}

function isFolgaComputable(label: string): boolean {
  const u = normalizeOperationalLabel(label).toUpperCase();
  return new Set(PAO_REST_TYPES.map((t) => t.toUpperCase())).has(u);
}

function computeDisplayWorkDays(stats: EmployeeOperationalSummary): number {
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

function bumpAllocLabel(stats: EmployeeOperationalSummary, label: string): void {
  const n = normalizeOperationalLabel(label).toUpperCase();
  if (n === "ND") {
    if (stats.type === "PAO") stats.nd++;
    return;
  }
  if (n === "VOO") {
    stats.voos++;
    return;
  }
  if (n === "SIMULADOR") {
    stats.simuladores++;
    return;
  }
  if (n === "CURSO" || n === "CURSO ONLINE") {
    stats.cursos++;
    return;
  }
  if (n === "CMA") {
    stats.cma++;
    return;
  }
  if (n === "OUTRO") {
    stats.outros++;
    return;
  }
  if (n === "FOLGA SOCIAL") {
    stats.folgaSocial++;
    stats.folgas++;
    return;
  }
  if (n === "FOLGA AGRUPADA" || n === "FA") {
    stats.fa++;
    stats.folgas++;
    return;
  }
  if (n === "FOLGA ANIVERSÁRIO" || n === "FANI") {
    stats.fani++;
    stats.folgas++;
    return;
  }
  if (isFpLabel(label)) {
    stats.fp++;
    stats.folgas++;
    return;
  }
  if (isFeriasLabel(label)) {
    stats.ferias++;
    return;
  }
  if (isFolgaComputable(label)) {
    stats.folgas++;
  }
}

function emptyStats(emp: { uuid: string; employee: { name: string; role: string } }): EmployeeOperationalSummary {
  return {
    employeeUuid: emp.uuid,
    name: emp.employee.name,
    type: emp.employee.role,
    turnos: 0,
    assignedShiftCount: 0,
    diasTrabalhados: 0,
    folgas: 0,
    folgaSocial: 0,
    folgaSocialOk: false,
    fa: 0,
    fani: 0,
    fp: 0,
    ferias: 0,
    disponivel: 0,
    availableForFlight: [],
    t6: 0,
    t7: 0,
    t8: 0,
    nd: 0,
    voos: 0,
    simuladores: 0,
    cursos: 0,
    cma: 0,
    outros: 0,
    folgasAjusteOperacional: false,
    maxConsec: 0,
    status: "OK",
    statusReason: null,
  };
}

/** Contagem exclusiva por dia — evita dupla contagem no fechamento matemático. */
function exclusiveDayBuckets(
  ws: GenerationWorkspace,
  uuid: string,
): { trabalho: number; folgas: number; ferias: number; disponivel: number } {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return { trabalho: 0, folgas: 0, ferias: 0, disponivel: 0 };

  let trabalho = 0;
  let folgas = 0;
  let ferias = 0;
  let disponivel = 0;

  for (const day of ws.days) {
    const shift = ws.planned.get(assignmentKey(did, day));
    const dayAllocs = ws.allocations.filter((a) => a.employeeUuid === uuid && a.date === day);
    const labels = dayAllocs.map((a) => normalizeOperationalLabel(a.label).toUpperCase());

    if (labels.some((l) => isFeriasLabel(l))) {
      ferias++;
      continue;
    }
    if (shift) {
      trabalho++;
      continue;
    }
    if (labels.some((l) => l === "ND" || l === "VOO" || l === "SIMULADOR" || l === "CMA" || l === "OUTRO" || l.includes("CURSO"))) {
      trabalho++;
      continue;
    }
    if (labels.some((l) => isFolgaComputable(l) || l === "FOLGA ANIVERSÁRIO" || l === "FANI")) {
      folgas++;
      continue;
    }
    disponivel++;
  }

  return { trabalho, folgas, ferias, disponivel };
}

export function buildOperationalSummary(
  ws: GenerationWorkspace,
  violations: ValidationIssue[] = [],
): OperationalSummaryResult {
  const byUuid = new Map<string, EmployeeOperationalSummary>();
  for (const e of ws.input.employees) {
    byUuid.set(e.uuid, emptyStats(e));
  }

  const apaoCodes = apaoTurnoCodes(ws);
  const paoCodes = paoTurnoCodes(ws);

  for (const a of ws.toAssignments()) {
    const stats = byUuid.get(a.employeeUuid);
    if (!stats) continue;
    const code = a.shiftCode.toUpperCase();
    if (stats.type === "PAO" && paoCodes.has(code)) {
      stats.turnos++;
      stats.assignedShiftCount++;
      if (code === "T6") stats.t6++;
      if (code === "T7") stats.t7++;
      if (code === "T8") stats.t8++;
    } else if (stats.type === "APAO" && apaoCodes.has(code)) {
      stats.turnos++;
      stats.assignedShiftCount++;
    }
  }

  for (const al of ws.allocations) {
    const stats = byUuid.get(al.employeeUuid);
    if (!stats) continue;
    bumpAllocLabel(stats, al.label);
  }

  for (const stats of byUuid.values()) {
    stats.diasTrabalhados = computeDisplayWorkDays(stats);
  }

  const availableMap = listAvailableForFlightFromWorkspace(ws);
  const daysInMonth = ws.days.length;
  const mathClosureErrors: string[] = [];

  for (const stats of byUuid.values()) {
    stats.folgaSocialOk = stats.folgaSocial >= 2;
    stats.folgasAjusteOperacional = stats.folgas === IDEAL_PAO_REST_COUNT + 1;
    stats.maxConsec = maxConsecutiveWorkDays(workDatesFromWorkspace(ws, stats.employeeUuid));
    const evaluation = evaluateEmployeeOperationalStatus(stats, violations, { daysInMonth });
    stats.status = evaluation.status;
    stats.statusReason = evaluation.statusReason;

    if (ws.paoEmps.some((p) => p.uuid === stats.employeeUuid)) {
      const buckets = exclusiveDayBuckets(ws, stats.employeeUuid);
      const flightDays = availableMap.get(stats.employeeUuid) ?? [];
      stats.availableForFlight = flightDays;
      stats.disponivel = buckets.disponivel;
      const closed = buckets.trabalho + buckets.folgas + buckets.ferias + buckets.disponivel;
      if (closed !== daysInMonth) {
        mathClosureErrors.push(
          `${stats.name}: ${buckets.trabalho}+${buckets.folgas}+${buckets.ferias}+${buckets.disponivel}=${closed} ≠ ${daysInMonth}`,
        );
      }
    } else if (stats.type === "APAO") {
      const buckets = exclusiveDayBuckets(ws, stats.employeeUuid);
      stats.disponivel = buckets.disponivel;
      stats.availableForFlight = [];
      const closed = buckets.trabalho + buckets.folgas + buckets.ferias + buckets.disponivel;
      if (closed !== daysInMonth) {
        mathClosureErrors.push(
          `${stats.name}: ${buckets.trabalho}+${buckets.folgas}+${buckets.ferias}+${buckets.disponivel}=${closed} ≠ ${daysInMonth}`,
        );
      }
    }
  }

  const byEmployee = [...byUuid.values()].sort((a, b) => a.name.localeCompare(b.name));

  const coverage = coveragePercentages(ws);
  const totals: OperationalTotals = {
    totalPaos: ws.paoEmps.length,
    totalApaos: ws.apaoEmps.length,
    totalTurnos: 0,
    totalDiasTrabalhados: 0,
    totalFolgas: 0,
    totalFolgaSocial: 0,
    totalFp: 0,
    totalFani: 0,
    totalFerias: 0,
    totalDisponiveis: 0,
    totalVoos: 0,
    totalSimuladores: 0,
    totalCursos: 0,
    totalNd: 0,
    totalCma: 0,
    totalOutros: 0,
    coverageT6: coverage.t6,
    coverageT7: coverage.t7,
    coverageT8: coverage.t8,
  };

  for (const s of byEmployee) {
    totals.totalTurnos += s.turnos;
    totals.totalDiasTrabalhados += s.diasTrabalhados;
    totals.totalFolgas += s.folgas;
    totals.totalFolgaSocial += s.folgaSocial;
    totals.totalFp += s.fp;
    totals.totalFani += s.fani;
    totals.totalFerias += s.ferias;
    totals.totalDisponiveis += s.disponivel;
    totals.totalVoos += s.voos;
    totals.totalSimuladores += s.simuladores;
    totals.totalCursos += s.cursos;
    totals.totalNd += s.nd;
    totals.totalCma += s.cma;
    totals.totalOutros += s.outros;
  }

  return {
    byEmployee,
    totals,
    mathClosureOk: mathClosureErrors.length === 0,
    mathClosureErrors,
  };
}

/** Conta folgas computáveis (F+FS+FA+FP) no contexto de validação. */
export function countFolgasComputableInContext(
  ctx: ScheduleContext,
  employeeId: number,
): number {
  const restSet = new Set(PAO_REST_TYPES.map((t) => t.toUpperCase()));
  return ctx.allocations.filter(
    (a) =>
      a.employeeId === employeeId &&
      restSet.has(a.allocType.toUpperCase()),
  ).length;
}
