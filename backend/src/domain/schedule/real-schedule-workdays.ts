import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { WorkdayBreakdown } from "./real-schedule-types.js";
import {
  isParallelShiftCode,
  listPaoRateioShiftCodesFromWorkspace,
} from "./pao-rateio-shifts.js";

const USEFUL_CADASTRO = new Set([
  "CURSO",
  "CURSO ONLINE",
  "SIMULADOR",
  "CMA",
  "OUTRO",
  "VOO",
]);

function bumpCadastro(stats: WorkdayBreakdown, label: string): void {
  const n = normalizeOperationalLabel(label).toUpperCase();
  if (n === "ND") return;
  if (n === "VOO") {
    stats.voos++;
    stats.total++;
    return;
  }
  if (n === "SIMULADOR") {
    stats.simuladores++;
    stats.total++;
    return;
  }
  if (n === "CURSO" || n === "CURSO ONLINE") {
    stats.cursos++;
    stats.total++;
    return;
  }
  if (n === "CMA") {
    stats.cma++;
    stats.total++;
    return;
  }
  if (n === "OUTRO") {
    stats.outros++;
    stats.total++;
    return;
  }
}

/** Conta dias trabalhados conforme fórmula do motor real (ND não conta). */
export function countWorkdayBreakdown(ws: GenerationWorkspace, uuid: string): WorkdayBreakdown {
  const stats: WorkdayBreakdown = {
    turnosT6: 0,
    turnosT7: 0,
    turnosT8: 0,
    voos: 0,
    cursos: 0,
    simuladores: 0,
    cma: 0,
    outros: 0,
    total: 0,
  };

  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    const code = a.shiftCode.toUpperCase();
    const rateioCodes = new Set(listPaoRateioShiftCodesFromWorkspace(ws));
    if (!rateioCodes.has(code)) continue;
    if (isParallelShiftCode(ws, code)) continue;
    if (code === "T6") stats.turnosT6++;
    else if (code === "T7") stats.turnosT7++;
    else if (code === "T8") stats.turnosT8++;
    stats.total++;
  }

  for (const al of ws.allocations) {
    if (al.employeeUuid !== uuid) continue;
    const n = normalizeOperationalLabel(al.label).toUpperCase();
    if (USEFUL_CADASTRO.has(n)) bumpCadastro(stats, al.label);
  }

  return stats;
}

export function countMotorWorkDays(ws: GenerationWorkspace, uuid: string): number {
  return countWorkdayBreakdown(ws, uuid).total;
}

export function countT8Shifts(ws: GenerationWorkspace, uuid: string): number {
  return countWorkdayBreakdown(ws, uuid).turnosT8;
}
