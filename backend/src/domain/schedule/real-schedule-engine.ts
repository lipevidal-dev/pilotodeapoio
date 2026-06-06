import { validateSchedule } from "../rules/engine.js";
import { runFinalCoverageGate } from "../rules/coverage-gate.js";
import { IDEAL_PAO_REST_COUNT } from "../rules/constants.js";
import { calculateOperationalDemand } from "./demand-planning-demand.js";
import { buildBlockPlans } from "./demand-planning-blocks.js";
import { materializeBlockPlans } from "./demand-planning-materialize.js";
import { buildGenerationInsights } from "./generation-insights.js";
import { buildExtendedSummary } from "./generation-summary.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { operationalBalancer } from "./operational-balancer.js";
import { ScheduleRepairEngine } from "./schedule-repair-engine.js";
import { trimShiftsForMinimumFolgas } from "./real-schedule-folgas.js";
import { allocateFlightsForWorkdayDeficit } from "./real-schedule-flights.js";
import { coverResidualT6T7Only } from "./real-schedule-residual.js";
import { computeRealMotorTargets } from "./real-schedule-targets.js";
import {
  ENGINE_PATH,
  MOTOR_REAL_V1_LABEL,
  MOTOR_VERSION_ID,
  type RealMotorReport,
} from "./real-schedule-types.js";
import type { GenerationInput, GenerationResult } from "./generation-types.js";

export class RealScheduleEngine {
  constructor(private readonly repairEngine = new ScheduleRepairEngine()) {}

  execute(ws: GenerationWorkspace): RealMotorReport {
    const stepNotes: string[] = [];
    const demand = calculateOperationalDemand(ws.days.length);
    stepNotes.push(`[1] Dados carregados: ${ws.paoEmps.length} PAO(s), demanda ${demand.totalDemand}.`);

    ws.planFolgaSocial();

    ws.planT8CoverageRotating();
    const t8BlocksPlaced = ws.coverT8BlocksOnly();
    ws.ensureNdForT8Pairs();
    stepNotes.push(`[2] T8 primeiro: ${t8BlocksPlaced} bloco(s) T8/T8/ND.`);

    const { required, targets, warnings: targetWarnings } = computeRealMotorTargets(ws);
    stepNotes.push(`[3-4] ${required.length} PAO(s) classificados; turnos T6/T7 necessários calculados.`);

    const blockPlans = buildBlockPlans(targets);
    const materialized = materializeBlockPlans(ws, blockPlans);
    stepNotes.push(
      `[5] Blocos T6/T7: ${materialized.placedBlocks} bloco(s), ${materialized.placedShifts} turno(s).`,
    );
    if (materialized.failedBlocks > 0) {
      stepNotes.push(`[5] ${materialized.failedBlocks} bloco(s) não materializados (meta flexível −2/−3).`);
    }

    const residual = coverResidualT6T7Only(ws);
    stepNotes.push(
      `[5b] Cobertura residual T6/T7: ${residual.unitCoverageApplied} unitária(s); gaps ${residual.gapsBefore}→${residual.gapsAfter}.`,
    );

    const trimmed = trimShiftsForMinimumFolgas(ws);
    if (trimmed > 0) {
      coverResidualT6T7Only(ws);
      stepNotes.push(`[5c] ${trimmed} turno(s) removido(s) para abrir espaço às folgas mínimas.`);
    }

    ws.allocatePaoRestDaysAfterCoverage();
    const mono = ws.correctMonoFolgasPedidas();
    ws.ensureExactTenFolgasPerPao();
    ws.fillUnclassifiedPaoDays();
    ws.finalizePaoFolgaCounts();
    ws.correctMonoFolgasPedidas();
    stepNotes.push(
      `[6] Folgas: mínimo ${IDEAL_PAO_REST_COUNT}; mono-folgas ${mono.detected}/${mono.corrected}.`,
    );

    const flightsCreated = allocateFlightsForWorkdayDeficit(ws);
    stepNotes.push(`[7] Voos déficit: ${flightsCreated.length} alocado(s) para completar dias trabalhados.`);

    this.repairEngine.repair(ws, []);
    ws.coverT6T7Only();
    ws.coverT8BlocksOnly();
    ws.assignApaoWithPao();
    ws.coverT6T7Only();
    ws.allocateApaoRestDays();
    ws.completeApaoAgenda();
    ws.enforceApaoSixByOne();
    this.repairEngine.repair(ws, []);
    ws.coverT6T7Only();

    ws.repairIsolatedT8();
    ws.cleanupOrphanNd();
    ws.ensureNdForT8Pairs();
    ws.coverT8BlocksOnly();
    ws.ensureMinShiftsForFullMonthNoFlight();
    ws.completePaoAgenda();
    trimShiftsForMinimumFolgas(ws);
    this.repairEngine.repair(ws, []);
    ws.coverT6T7Only();
    ws.fillUnclassifiedPaoDays();
    ws.ensureExactTenFolgasPerPao();
    ws.finalizePaoFolgaCounts();

    return {
      motorVersion: MOTOR_VERSION_ID,
      demand,
      requiredShifts: required,
      targets,
      t8BlocksPlaced,
      t6T7BlocksPlaced: materialized.placedBlocks,
      t6T7ShiftsPlaced: materialized.placedShifts,
      residualUnitCoverage: residual.unitCoverageApplied,
      flightsForDeficit: flightsCreated.length,
      stepNotes,
      warnings: targetWarnings,
    };
  }

  generate(input: GenerationInput): GenerationResult {
    const startedAt = performance.now();
    const ws = new GenerationWorkspace(input);
    const engineSuggestions: string[] = [];

    ws.applyHardBlocks();
    const motorReport = this.execute(ws);

    for (const note of motorReport.stepNotes) {
      engineSuggestions.push(note);
    }
    engineSuggestions.push(MOTOR_REAL_V1_LABEL);

    const balanceReport = operationalBalancer.balance(ws, [
      ...ws.birthdayWarnings,
      ...ws.noFlightWarnings,
      ...ws.monoFolgaWarnings,
      ...motorReport.warnings,
    ]);
    motorReport.balanceReport = balanceReport;
    stepNotesBalance(motorReport, balanceReport);

    for (const w of balanceReport.warnings) {
      engineSuggestions.push(w.detail);
    }

    const assignments = ws.toAssignments();
    const ctx = ws.toScheduleContext();
    const engineViolations = validateSchedule(ctx);
    const gate = runFinalCoverageGate(ctx);

    const seen = new Set<string>();
    const violations = [
      ...ws.birthdayWarnings,
      ...ws.noFlightWarnings,
      ...ws.monoFolgaWarnings,
      ...motorReport.warnings,
      ...balanceReport.warnings,
      ...engineViolations,
      ...gate.issues,
    ].filter((i) => {
      const k = `${i.type}|${i.date}|${i.employee}|${i.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const folgasPerPao: Record<string, number> = {};
    for (const c of ws.paoEmps) {
      folgasPerPao[c.employee.name] = ws.countRest(c.uuid);
    }

    const coverageGaps = ws.listCoverageGaps().length;
    if (coverageGaps > 0) {
      engineSuggestions.push(
        `${coverageGaps} furo(s) de cobertura — revise equipe, bloqueios e blocos T8/T8/ND.`,
      );
    }
    for (const c of ws.paoEmps) {
      const n = folgasPerPao[c.employee.name];
      if (n < IDEAL_PAO_REST_COUNT) {
        engineSuggestions.push(
          `${c.employee.name}: ${n}/${IDEAL_PAO_REST_COUNT} folgas — revise carga do mês.`,
        );
      }
    }

    const insights = buildGenerationInsights(
      ws,
      violations,
      { repaired: 0, remainingGaps: coverageGaps, suggestions: [] },
      engineSuggestions,
    );
    const generationMs = Math.round(performance.now() - startedAt);

    const summary = buildExtendedSummary(ws, violations, {
      totalAssignments: assignments.length,
      totalAllocations: ws.allocations.length,
      paoCount: ws.paoEmps.length,
      apaoCount: ws.apaoEmps.length,
      folgasPerPao,
      coverageGaps,
      repairsApplied: 0,
      repairRemainingGaps: coverageGaps,
      generationMs,
      impossibleScenario: insights.impossibleScenario,
      mainBlockingReasons: insights.mainBlockingReasons,
      balanceReport,
      motorVersion: MOTOR_VERSION_ID,
      enginePath: ENGINE_PATH,
      realEngineExecuted: true,
      realMotorReport: motorReport as unknown as Record<string, unknown>,
    });

    return {
      assignments,
      allocations: ws.allocations,
      violations,
      summary,
      success: summary.valid,
      suggestions: insights.suggestions,
    };
  }
}

function stepNotesBalance(
  report: RealMotorReport,
  balanceReport: NonNullable<RealMotorReport["balanceReport"]>,
): void {
  report.stepNotes.push(
    `[9] Balanceador: aceitável=${balanceReport.acceptable ? "sim" : "não"}, ${balanceReport.actions.length} ação(ões).`,
  );
}

export const realScheduleEngine = new RealScheduleEngine();
