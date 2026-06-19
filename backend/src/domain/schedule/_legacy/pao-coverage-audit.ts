import { MIN_SHIFTS_FULL_NO_FLIGHT_MONTH } from "../../employee/restrictions.js";
import { analyzeT6T7BlockCoverage } from "./coverage-block-metrics.js";
import type { MonoFolgaAuditResult } from "./mono-folga-pedida.js";
import {
  countOperationalShifts,
  operationalShiftBreakdown,
} from "./pao-operational-shifts.js";
import {
  hasVacationInMonth,
  vacationDaysForPao,
} from "./pao-operational-priority.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

export interface FullMonthNoFlightAudit {
  employeeUuid: string;
  employeeName: string;
  shiftCount: number;
  reached20: boolean;
  breakdown: Record<string, number>;
}

export interface VacationPaoAudit {
  employeeUuid: string;
  employeeName: string;
  vacationDays: number;
  shiftsBeforeVacation: number;
  shiftsAfterVacation: number;
  totalOperationalShifts: number;
}

export interface PaoCoverageAuditReport {
  fullMonthNoFlight: FullMonthNoFlightAudit[];
  vacationPao: VacationPaoAudit[];
  t6Blocks: { blockCount: number; averageBlockSize: number; unitCoverageCount: number };
  t7Blocks: { blockCount: number; averageBlockSize: number; unitCoverageCount: number };
  unitCoverageTotal: number;
  monoFolgas: {
    detected: number;
    corrected: number;
    kept: Array<{ employee: string; date: string; reason: string }>;
  };
}

function shiftsInRange(
  ws: GenerationWorkspace,
  uuid: string,
  fromDay: string | null,
  toDay: string | null,
): number {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return 0;
  let count = 0;
  for (const day of ws.days) {
    if (fromDay && day < fromDay) continue;
    if (toDay && day > toDay) continue;
    if (ws.planned.has(`${did}|${day}`)) count++;
  }
  return count;
}

export function buildPaoCoverageAudit(
  ws: GenerationWorkspace,
  monoFolga?: MonoFolgaAuditResult,
): PaoCoverageAuditReport {
  const blockMetrics = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);

  const fullMonthNoFlight: FullMonthNoFlightAudit[] = [];
  for (const c of ws.paoEmps) {
    if (!ws.isFullMonthNoFlight(c.uuid)) continue;
    const shiftCount = countOperationalShifts(ws, c.uuid);
    fullMonthNoFlight.push({
      employeeUuid: c.uuid,
      employeeName: c.employee.name,
      shiftCount,
      reached20: shiftCount >= MIN_SHIFTS_FULL_NO_FLIGHT_MONTH,
      breakdown: operationalShiftBreakdown(ws, c.uuid),
    });
  }

  const vacationPao: VacationPaoAudit[] = [];
  for (const c of ws.paoEmps) {
    if (!hasVacationInMonth(ws, c.uuid)) continue;
    const vacDays = vacationDaysForPao(ws, c.uuid);
    const firstVac = vacDays[0];
    const lastVac = vacDays[vacDays.length - 1];
    const beforeEnd = ws.days[ws.days.indexOf(firstVac) - 1] ?? null;
    const afterStart = ws.days[ws.days.indexOf(lastVac) + 1] ?? null;

    vacationPao.push({
      employeeUuid: c.uuid,
      employeeName: c.employee.name,
      vacationDays: vacDays.length,
      shiftsBeforeVacation: beforeEnd
        ? shiftsInRange(ws, c.uuid, ws.days[0], beforeEnd)
        : 0,
      shiftsAfterVacation: afterStart
        ? shiftsInRange(ws, c.uuid, afterStart, ws.days[ws.days.length - 1])
        : 0,
      totalOperationalShifts: countOperationalShifts(ws, c.uuid),
    });
  }

  const mono = monoFolga ?? { detected: 0, corrected: 0, attempts: [] };

  return {
    fullMonthNoFlight,
    vacationPao,
    t6Blocks: {
      blockCount: blockMetrics.T6.blockCount,
      averageBlockSize: blockMetrics.T6.averageBlockSize,
      unitCoverageCount: blockMetrics.T6.unitCoverageCount,
    },
    t7Blocks: {
      blockCount: blockMetrics.T7.blockCount,
      averageBlockSize: blockMetrics.T7.averageBlockSize,
      unitCoverageCount: blockMetrics.T7.unitCoverageCount,
    },
    unitCoverageTotal: blockMetrics.unitCoverageTotal,
    monoFolgas: {
      detected: mono.detected,
      corrected: mono.corrected,
      kept: mono.attempts
        .filter((a) => !a.corrected)
        .map((a) => ({
          employee: a.employeeName,
          date: a.fpDate,
          reason: a.reason ?? "inviável",
        })),
    },
  };
}

export function formatPaoCoverageAuditNotes(report: PaoCoverageAuditReport): string[] {
  const notes: string[] = [];

  notes.push("--- Cobertura PAO por prioridade operacional (Fase 7.1) ---");

  if (report.fullMonthNoFlight.length === 0) {
    notes.push("PAOs com mês inteiro sem voo: nenhum.");
  } else {
    notes.push("PAOs com mês inteiro sem voo:");
    for (const row of report.fullMonthNoFlight) {
      const status = row.reached20 ? "atingiu 20" : "NÃO atingiu 20";
      notes.push(
        `  • ${row.employeeName}: ${row.shiftCount} turnos (T6=${row.breakdown.T6}, T7=${row.breakdown.T7}, T8=${row.breakdown.T8}, ND=${row.breakdown.ND}) — ${status}`,
      );
    }
  }

  if (report.vacationPao.length === 0) {
    notes.push("PAOs com férias no mês: nenhum.");
  } else {
    notes.push("PAOs com férias no mês:");
    for (const row of report.vacationPao) {
      notes.push(
        `  • ${row.employeeName}: ${row.vacationDays} dia(s) férias — antes=${row.shiftsBeforeVacation}, depois=${row.shiftsAfterVacation}, total=${row.totalOperationalShifts}`,
      );
    }
  }

  notes.push(
    `Blocos T6: ${report.t6Blocks.blockCount} bloco(s), média ${report.t6Blocks.averageBlockSize} dia(s), unitárias=${report.t6Blocks.unitCoverageCount}`,
  );
  notes.push(
    `Blocos T7: ${report.t7Blocks.blockCount} bloco(s), média ${report.t7Blocks.averageBlockSize} dia(s), unitárias=${report.t7Blocks.unitCoverageCount}`,
  );
  notes.push(`Coberturas unitárias totais (T6+T7): ${report.unitCoverageTotal}`);
  notes.push(
    `Mono-folgas: detectadas=${report.monoFolgas.detected}, corrigidas=${report.monoFolgas.corrected}, mantidas=${report.monoFolgas.kept.length}`,
  );
  for (const kept of report.monoFolgas.kept) {
    notes.push(`  • ${kept.employee} em ${kept.date}: ${kept.reason}`);
  }

  return notes;
}
