import { operationalBalancer } from "./operational-balancer.js";
import { calculateOperationalDemand } from "./demand-planning-demand.js";
import { calculateCapacitySummary } from "./demand-planning-capacity.js";
import { computeIndividualTargets } from "./demand-planning-targets.js";
import {
  averageBlockSize,
  buildBlockPlans,
} from "./demand-planning-blocks.js";
import { materializeBlockPlans } from "./demand-planning-materialize.js";
import { coverResidualGaps } from "./demand-planning-residual.js";
import type { DemandPlanningReport } from "./demand-planning-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

function formatPlanningNotes(report: DemandPlanningReport): string[] {
  const notes: string[] = [];
  notes.push(
    `Demanda: ${report.demand.totalDemand} turnos (${report.demand.daysInMonth} dias × ${report.demand.shiftsPerDay})`,
  );
  notes.push(
    `Capacidade total: ${report.capacity.totalCapacity} | Saldo: ${report.operationalBalance}`,
  );
  notes.push(
    `Blocos planejados: ${report.blockPlans.reduce((n, p) => n + p.plannedBlocks.length, 0)} | Média: ${report.averageBlockSize} dias`,
  );
  notes.push(
    `Coberturas unitárias: ${report.unitCoverageApplied} (antes ${report.unitCoverageBefore} gaps → depois ${report.unitCoverageAfter})`,
  );
  if (report.balanceReport) {
    notes.push(
      `Balanceador: ${report.balanceReport.iterations} iteração(ões), ${report.balanceReport.actions.length} ajuste(s)`,
    );
  }
  return notes;
}

export class DemandPlanningEngine {
  execute(ws: GenerationWorkspace): DemandPlanningReport {
    const stepNotes: string[] = [];

    const demand = calculateOperationalDemand(ws.days.length, ws.input.shifts);
    stepNotes.push(`[1] Demanda operacional: ${demand.totalDemand} turnos.`);

    const capacity = calculateCapacitySummary(ws);
    const operationalBalance = capacity.totalCapacity - demand.totalDemand;
    stepNotes.push(
      `[2] Capacidade: ${capacity.totalCapacity} turnos (saldo ${operationalBalance >= 0 ? "+" : ""}${operationalBalance}).`,
    );

    const targets = computeIndividualTargets(ws, demand);
    stepNotes.push(`[3] Metas individuais definidas para ${targets.length} PAO(s).`);

    const blockPlans = buildBlockPlans(targets);
    const avgBlock = averageBlockSize(blockPlans);
    stepNotes.push(
      `[4-5] ${blockPlans.reduce((n, p) => n + p.plannedBlocks.length, 0)} bloco(s) planejados (média ${avgBlock} dias).`,
    );

    const materialized = materializeBlockPlans(ws, blockPlans);
    stepNotes.push(
      `[6] Materialização: ${materialized.placedBlocks} bloco(s), ${materialized.placedShifts} turno(s).`,
    );
    if (materialized.failedBlocks > 0) {
      stepNotes.push(`[6] ${materialized.failedBlocks} bloco(s) não materializados.`);
    }

    const residual = coverResidualGaps(ws);
    stepNotes.push(
      `[7] Cobertura residual: ${residual.unitCoverageApplied} unitária(s); gaps ${residual.gapsBefore}→${residual.gapsAfter}.`,
    );

    ws.planFolgaSocial();
    ws.allocatePaoRestDaysAfterCoverage();
    const mono = ws.correctMonoFolgasPedidas();
    ws.ensureExactTenFolgasPerPao();
    ws.finalizePaoFolgaCounts();
    stepNotes.push(
      `[8] Folgas aplicadas; mono-folgas detectadas ${mono.detected}, corrigidas ${mono.corrected}.`,
    );

    const flightCreated = ws.applyFlightsToAvailablePaoDays();
    stepNotes.push(`[9] Voos alocados: ${flightCreated.length} (respeitando restrições).`);

    const balanceReport = operationalBalancer.balance(ws, [
      ...ws.birthdayWarnings,
      ...ws.noFlightWarnings,
      ...ws.monoFolgaWarnings,
    ]);
    stepNotes.push(
      `[10] Balanceador: aceitável=${balanceReport.acceptable ? "sim" : "não"}, ${balanceReport.actions.length} ação(ões).`,
    );

    stepNotes.push("[11] Validação final delegada ao motor de etapas.");

    const report: DemandPlanningReport = {
      demand,
      capacity,
      operationalBalance,
      targets,
      blockPlans,
      averageBlockSize: avgBlock,
      unitCoverageBefore: residual.gapsBefore,
      unitCoverageApplied: residual.unitCoverageApplied,
      unitCoverageAfter: residual.gapsAfter,
      balanceReport,
      warnings: [...balanceReport.warnings],
      stepNotes: [...stepNotes, ...formatPlanningNotes({
        demand,
        capacity,
        operationalBalance,
        targets,
        blockPlans,
        averageBlockSize: avgBlock,
        unitCoverageBefore: residual.gapsBefore,
        unitCoverageApplied: residual.unitCoverageApplied,
        unitCoverageAfter: residual.gapsAfter,
        balanceReport,
        warnings: balanceReport.warnings,
        stepNotes: [],
      })],
    };

    return report;
  }
}

export const demandPlanningEngine = new DemandPlanningEngine();

export function formatDemandPlanningReportNotes(report: DemandPlanningReport): string[] {
  return report.stepNotes;
}
