import type { GenerationWorkspace } from "./generation-workspace.js";
import type { WorkdayBreakdown } from "./real-schedule-types.js";
import { listPaoRateioShiftCodesFromWorkspace } from "./pao-rateio-shifts.js";
import { normalizeOperationalLabel } from "./operational-labels.js";

/** Conta dias trabalhados: turnos de rateio (inclui T9). Cadastros operacionais não entram. */
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

  const rateioCodes = new Set(listPaoRateioShiftCodesFromWorkspace(ws));

  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    const code = a.shiftCode.toUpperCase();
    if (!rateioCodes.has(code)) continue;
    if (code === "T6") stats.turnosT6++;
    else if (code === "T7") stats.turnosT7++;
    else if (code === "T8") stats.turnosT8++;
    stats.total++;
  }

  for (const al of ws.allocations) {
    if (al.employeeUuid !== uuid) continue;
    const n = normalizeOperationalLabel(al.label).toUpperCase();
    if (n === "VOO") stats.voos++;
    else if (n === "SIMULADOR") stats.simuladores++;
    else if (n === "CURSO" || n === "CURSO ONLINE") stats.cursos++;
    else if (n === "CMA") stats.cma++;
    else if (n === "OUTRO") stats.outros++;
  }

  return stats;
}

export function countMotorWorkDays(ws: GenerationWorkspace, uuid: string): number {
  return countWorkdayBreakdown(ws, uuid).total;
}
