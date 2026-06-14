import { validateSchedule } from "../rules/engine.js";
import { runFinalCoverageGate } from "../rules/coverage-gate.js";
import { IDEAL_PAO_REST_COUNT } from "../rules/constants.js";
import { calculateTurnRateioDemand } from "./demand-planning-demand.js";
import { buildGenerationInsights } from "./generation-insights.js";
import { buildExtendedSummary } from "./generation-summary.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { blockOptimizer } from "./block-optimizer.js";
import { finalizeT8NdBlocks } from "./schedule-grid-source.js";
import { operationalBalancer } from "./operational-balancer.js";
import {
  preferIdealFolgaCount,
  repairIsolatedRestDays,
  trimShiftsForMinimumFolgas,
} from "./real-schedule-folgas.js";
import { allocateFlightsForWorkdayDeficit } from "./real-schedule-flights.js";
import { deduplicatePaoShiftCoverage } from "./pao-shift-dedup.js";
import { repairT8GapsAfterDedup } from "./repair-t8-gaps-after-dedup.js";
import {
  repairAllCoverageGapsFinal,
  validateNoCoverageGaps,
} from "./repair-all-coverage-gaps-final.js";
import { optimizeEmergencyIsolatedT8 } from "./optimize-emergency-isolated-t8.js";
import { captureOptimizationSnapshot, restoreOptimizationSnapshot } from "./workspace-optimization-transaction.js";
import { coverResidualT6T7Only } from "./real-schedule-residual.js";
import {
  enforceMinimumTurnTargets,
  enforceProportionalTurnTargets,
  finalizeMinimumTurnTargetsForSave,
  validateRateioMinimums,
} from "./enforce-minimum-turn-targets.js";
import { computeRealMotorTargets } from "./real-schedule-targets.js";
import { materializeT6T7BlocksStrict } from "./real-schedule-blocks.js";
import { buildStructuralMetrics } from "./real-schedule-audit.js";
import { buildEmployeeDiagnostics } from "./real-schedule-employee-diagnostics.js";
import {
  buildRealV1FolgaReport,
  countAutoCommonFolgas,
} from "./real-schedule-folga-metrics.js";
import { allocateParallelShifts } from "./real-schedule-parallel.js";
import { allocateT8BlocksStrict, closeT8CoverageGaps } from "./real-schedule-t8.js";
import { materializeVacationFortnightPatterns } from "./real-schedule-vacation-materialize.js";
import {
  ENGINE_PATH,
  MOTOR_REAL_V1_LABEL,
  MOTOR_VERSION_ID,
  type RealMotorReport,
} from "./real-schedule-types.js";
import { ScheduleRepairEngine } from "./schedule-repair-engine.js";
import type { GenerationInput, GenerationResult } from "./generation-types.js";

export class RealScheduleEngine {
  constructor(private readonly repairEngine = new ScheduleRepairEngine()) {}

  execute(ws: GenerationWorkspace): RealMotorReport {
    ws.realV1ManualCommonFolga = true;
    ws.enforceMonthStart6x1FromPrevious();
    const stepNotes: string[] = [];
    const warnings: RealMotorReport["warnings"] = [];
    const demand = calculateTurnRateioDemand(ws.days.length, ws.input.shifts);
    stepNotes.push(`[1] Dados carregados: ${ws.paoEmps.length} PAO(s), demanda ${demand.totalDemand}.`);
    stepNotes.push(
      "[1b] REAL_V1: turnos + 1 folga social/PAO; folga comum, FA e voos ficam para edição manual.",
    );

    ws.planFolgaSocial();

    ws.initRateioContext();
    const mainMax = [...ws.rateioContext!.mainPoolEmployeeIds]
      .map((id) => ws.rateioContext!.maxTurnCounts.get(id))
      .find((v) => v != null);
    stepNotes.push(
      `[1d] Rateio unificado: pool principal=${ws.rateioContext!.mainPoolEmployeeIds.size}, ` +
        `T8=${ws.rateioContext!.t8PoolEmployeeIds.size}, T9=${ws.rateioContext!.t9PoolEmployeeIds.size}` +
        (mainMax != null ? `; max turnos principal=${mainMax}` : "") +
        ".",
    );

    const t8 = allocateT8BlocksStrict(ws);
    stepNotes.push(
      `[2] T8 estrito: ${t8.blocksPlaced} bloco(s) T8/T8/ND; gaps=${t8.coverageGaps}; isolados=${t8.audit.isolatedT8Count}; pares sem ND=${t8.audit.pairsWithoutNdCount}.`,
    );

    const vacation = materializeVacationFortnightPatterns(ws);
    warnings.push(...vacation.warnings);
    stepNotes.push(
      `[3] Férias quinzenais: ${vacation.processedCount} PAO(s); ${vacation.workDaysPlaced} trabalho(s); ${vacation.folgasPlaced} folga(s) no padrão 3/2.`,
    );
    if (vacation.belowPattern.length > 0) {
      stepNotes.push(
        `[3] ${vacation.belowPattern.length} PAO(s) abaixo do padrão 3/2 esperado.`,
      );
    }

    const {
      required,
      targets,
      turnRateio,
      turnosRateio,
      metaTurnosNormal,
      warnings: targetWarnings,
    } = computeRealMotorTargets(ws);
    warnings.push(...targetWarnings);
    stepNotes.push(
      `[4] ${required.length} PAO(s) classificados; rateio turnos=${turnosRateio}, meta normal=${metaTurnosNormal.toFixed(1)}.`,
    );

    const blocks = materializeT6T7BlocksStrict(ws, targets);
    stepNotes.push(
      `[5] Blocos T6/T7 V3: ${blocks.placedBlocks} bloco(s), ${blocks.placedShifts} turno(s); unitários parciais=${blocks.unitPlacements}; tamanhos=${blocks.blockSizesPlaced.join(",") || "n/a"}.`,
    );
    if (blocks.failedBlocks > 0) {
      stepNotes.push(`[5] ${blocks.failedBlocks} bloco(s) não materializados (meta flexível −2/−3).`);
    }

    let residual = coverResidualT6T7Only(ws);
    let totalResidualBlocks = residual.blockCoverageApplied;
    let totalResidualUnits = residual.unitCoverageApplied;
    stepNotes.push(
      `[5b] Cobertura residual: blocos=${residual.blockCoverageApplied}; unitária=${residual.unitCoverageApplied}; gaps ${residual.gapsBefore}→${residual.gapsAfter}.`,
    );

    if (!ws.realV1ManualCommonFolga) {
      const trimmed = trimShiftsForMinimumFolgas(ws);
      if (trimmed > 0) {
        const residual2 = coverResidualT6T7Only(ws);
        totalResidualBlocks += residual2.blockCoverageApplied;
        totalResidualUnits += residual2.unitCoverageApplied;
        stepNotes.push(
          `[5c] ${trimmed} turno(s) removido(s) para folgas; residual blocos=${residual2.blockCoverageApplied}, unitária=${residual2.unitCoverageApplied}.`,
        );
      }
    }

    closeStructurePreservingGaps(ws, this.repairEngine, stepNotes, "[5d]", false);

    ws.allocatePaoRestDaysAfterCoverage();
    const mono = ws.correctMonoFolgasPedidas();
    if (!ws.realV1ManualCommonFolga) {
      ws.ensureExactTenFolgasPerPao();
      ws.fillUnclassifiedPaoDays();
    }
    ws.finalizePaoFolgaCounts();
    ws.correctMonoFolgasPedidas();
    const folgaReport = buildRealV1FolgaReport(ws);
    stepNotes.push(
      `[6] Folgas: FS=${folgaReport.socialFolgaGenerated}, FA=${folgaReport.groupedApaoFolgaGenerated}, vazios=${folgaReport.emptyDaysLeftForManualEditing}; mono-folgas ${mono.detected}/${mono.corrected}.`,
    );

    const flightsCreated = ws.realV1ManualCommonFolga ? [] : allocateFlightsForWorkdayDeficit(ws);
    if (flightsCreated.length > 0) {
      stepNotes.push(`[7] Voos déficit: ${flightsCreated.length} alocado(s) para completar dias trabalhados.`);
    } else if (ws.realV1ManualCommonFolga) {
      stepNotes.push("[7] Voos não gerados — alocação manual na escala.");
    }

    ws.ensureMinShiftsForFullMonthNoFlight();
    stepNotes.push("[7b] PAO mês sem voo: turnos priorizados até meta do rateio.");

    const parallel = allocateParallelShifts(ws);
    stepNotes.push(
      `[7c] Turnos paralelos: ${parallel.parallelShiftsAllocated} alocação(ões); ${Object.entries(parallel.byShift)
        .map(([code, detail]) => `${code}=${detail.days}`)
        .join(", ") || "nenhum"}.`,
    );

    ws.reconcileNdAfterParallelShifts();

    if (ws.apaoMotorEnabled) {
      ws.assignApaoWithPao();
      ws.allocateApaoRestDays();
      ws.completeApaoAgenda();
      ws.enforceApaoSixByOne();
      stepNotes.push("[8] APAO: turnos, FA e regime 6x1 aplicados pelo motor APAO.");
    } else {
      stepNotes.push(
        "[8] APAO omitido — use o botão Gerar Escala APAO após concluir folgas PAO.",
      );
    }

    closeStructurePreservingGaps(ws, this.repairEngine, stepNotes, "[8b]", true);
    ws.correctMonoFolgasPedidas();

    if (!ws.realV1ManualCommonFolga) {
      ws.fillUnclassifiedPaoDays();
      ws.ensureExactTenFolgasPerPao();
      preferIdealFolgaCount(ws);
      repairIsolatedRestDays(ws);
    }
    ws.finalizePaoFolgaCounts();
    ws.correctMonoFolgasPedidas();

    const assignments = ws.toAssignments();
    const structuralMetrics = buildStructuralMetrics(
      ws,
      assignments,
      vacation.belowPattern,
    );

    return {
      motorVersion: MOTOR_VERSION_ID,
      demand,
      requiredShifts: required,
      targets,
      turnRateio: turnRateio.map((e) => ({
        employeeUuid: e.employeeUuid,
        name: e.name,
        group: e.group,
        turnTarget: e.turnTarget,
        allocatedTurns: e.allocatedTurns,
        usefulOperationalDays: e.usefulOperationalDays,
        turnDeviation: e.turnDeviation,
        reasonForDeviation: e.reasonForDeviation,
      })),
      turnosRateio,
      metaTurnosNormal,
      t8BlocksPlaced: t8.blocksPlaced,
      t8CoverageGaps: t8.coverageGaps,
      t8IsolatedCount: structuralMetrics.isolatedT8Count,
      t8PairsWithoutNdCount: structuralMetrics.pairsWithoutNdCount,
      vacationFortnightProcessed: vacation.processedCount,
      vacationBelowPattern: vacation.belowPattern,
      t6T7BlocksPlaced: blocks.placedBlocks,
      t6T7ShiftsPlaced: blocks.placedShifts,
      v3BlockMaterializeAudit: blocks.v3BlockMaterializeAudit,
      residualBlockCoverage: totalResidualBlocks,
      residualUnitCoverage: totalResidualUnits,
      structuralMetrics,
      flightsForDeficit: flightsCreated.length,
      commonFolgaAutoGenerated: false,
      socialFolgaGenerated: folgaReport.socialFolgaGenerated,
      groupedApaoFolgaGenerated: folgaReport.groupedApaoFolgaGenerated,
      emptyDaysLeftForManualEditing: folgaReport.emptyDaysLeftForManualEditing,
      parallelShiftsAllocated: parallel.parallelShiftsAllocated,
      parallelShiftReport: parallel.byShift,
      stepNotes,
      warnings,
    };
  }

  generate(input: GenerationInput): GenerationResult {
    const startedAt = performance.now();
    const ws = new GenerationWorkspace(input);
    const engineSuggestions: string[] = [];

    ws.realV1ManualCommonFolga = true;
    ws.applyHardBlocks();
    const motorReport = this.execute(ws);

    for (const note of motorReport.stepNotes) {
      engineSuggestions.push(note);
    }
    engineSuggestions.push(MOTOR_REAL_V1_LABEL);

    if (motorReport.structuralMetrics) {
      const m = motorReport.structuralMetrics;
      engineSuggestions.push(
        `Estrutural: T6 blocos=${m.t6Blocks} (unit=${m.t6UnitCoverage}); T7 blocos=${m.t7Blocks} (unit=${m.t7UnitCoverage}); T8 isolados=${m.isolatedT8Count}; T8 sem ND=${m.pairsWithoutNdCount}.`,
      );
    }

    const balanceReport = operationalBalancer.balance(ws, [
      ...ws.birthdayWarnings,
      ...ws.noFlightWarnings,
      ...ws.monoFolgaWarnings,
      ...motorReport.warnings,
    ]);
    motorReport.balanceReport = balanceReport;
    stepNotesBalance(motorReport, balanceReport);

    if (ws.listCoverageGaps().length > 0) {
      closeStructurePreservingGaps(ws, this.repairEngine, motorReport.stepNotes, "[10]", true);
    }
    ws.correctMonoFolgasPedidas();
    ws.repairIsolatedT8();
    ws.cleanupOrphanNd();
    ws.ensureNdForT8Pairs();
    motorReport.structuralMetrics = buildStructuralMetrics(
      ws,
      ws.toAssignments(),
      motorReport.vacationBelowPattern,
    );
    motorReport.t8IsolatedCount = motorReport.structuralMetrics.isolatedT8Count;
    motorReport.t8PairsWithoutNdCount = motorReport.structuralMetrics.pairsWithoutNdCount;
    motorReport.employeeDiagnostics = buildEmployeeDiagnostics(ws);

    ws.correctMonoFolgasPedidas();
    const dupesRemoved = deduplicatePaoShiftCoverage(ws);
    if (dupesRemoved > 0) {
      motorReport.stepNotes.push(
        `[11b] Turnos PAO duplicados removidos: ${dupesRemoved} alocação(ões).`,
      );
      closeStructurePreservingGaps(ws, this.repairEngine, motorReport.stepNotes, "[11c]", true);
    }
    if (!ws.realV1ManualCommonFolga) {
      const folgasTrimmed = preferIdealFolgaCount(ws);
      const monoRestFixed = repairIsolatedRestDays(ws);
      if (folgasTrimmed > 0 || monoRestFixed > 0) {
        motorReport.stepNotes.push(
          `[11] Ajuste folgas: ${folgasTrimmed} acima do ideal; ${monoRestFixed} monofolga(s) reparada(s).`,
        );
      }
    }
    const finalFolgaReport = buildRealV1FolgaReport(ws);
    motorReport.socialFolgaGenerated = finalFolgaReport.socialFolgaGenerated;
    motorReport.groupedApaoFolgaGenerated = finalFolgaReport.groupedApaoFolgaGenerated;
    motorReport.emptyDaysLeftForManualEditing = finalFolgaReport.emptyDaysLeftForManualEditing;
    motorReport.commonFolgaAutoGenerated = false;
    ws.correctMonoFolgasPedidas();

    ws.syncRateioContext();
    const turnTargetEnforcement = enforceProportionalTurnTargets(ws);
    motorReport.stepNotes.push(
      `[11d] Meta proporcional: min ${turnTargetEnforcement.minimum.belowMinBefore}→${turnTargetEnforcement.minimum.belowMinAfter} abaixo do mínimo ` +
        `(${turnTargetEnforcement.minimum.transfers} transferência(s)); ` +
        `target ${turnTargetEnforcement.target.belowTargetBefore}→${turnTargetEnforcement.target.belowTargetAfter} abaixo da meta ` +
        `(${turnTargetEnforcement.target.transfers} transferência(s)).`,
    );

    const blockOptimizerReport = blockOptimizer.optimize(ws);
    motorReport.blockOptimizerReport = blockOptimizerReport;
    motorReport.stepNotes.push(
      `[12] Block Optimizer: score ${blockOptimizerReport.initialScore}→${blockOptimizerReport.finalScore}, ` +
        `${blockOptimizerReport.actionsCount} movimento(s), isolados=${blockOptimizerReport.metrics.turnosIsolados}, ` +
        `blocosDe2=${blockOptimizerReport.metrics.blocosDe2}.`,
    );
    if (blockOptimizerReport.improved) {
      engineSuggestions.push(
        `Block Optimizer: score ${blockOptimizerReport.initialScore} → ${blockOptimizerReport.finalScore} ` +
          `(${blockOptimizerReport.actionsCount} movimento(s)).`,
      );
    }

    ws.correctMonoFolgasPedidas();
    ws.repairIsolatedT8();
    ws.cleanupOrphanNd();
    ws.ensureNdForT8Pairs();
    ws.reconcileNdAfterParallelShifts();
    ws.revalidateCoverageAfterBalance();

    ws.syncRateioContext();
    const postOptimizerEnforcement = enforceProportionalTurnTargets(ws);
    if (
      postOptimizerEnforcement.minimum.transfers > 0 ||
      postOptimizerEnforcement.target.transfers > 0
    ) {
      motorReport.stepNotes.push(
        `[12b] Pós-optimizer: min ${postOptimizerEnforcement.minimum.belowMinBefore}→${postOptimizerEnforcement.minimum.belowMinAfter}; ` +
          `${postOptimizerEnforcement.minimum.transfers + postOptimizerEnforcement.target.transfers} transferência(s).`,
      );
    }

    const finalCoverage = runFinalCoveragePipeline(ws);

    ws.syncRateioContext();
    const finalEnforcement = enforceProportionalTurnTargets(ws);
    const unenforcedMin = finalEnforcement.rateioMinimums.issues.filter((i) => i.hasValidTransfer);
    if (
      finalEnforcement.minimum.transfers > 0 ||
      finalEnforcement.target.transfers > 0 ||
      finalEnforcement.minimumAfterTarget.transfers > 0 ||
      unenforcedMin.length > 0
    ) {
      motorReport.stepNotes.push(
        `[14] Enforce final pós-cobertura: min ${finalEnforcement.minimum.belowMinBefore}→${finalEnforcement.minimum.belowMinAfter} ` +
          `(${finalEnforcement.minimum.transfers} transf); target ${finalEnforcement.target.transfers} transf; ` +
          `min pós-target ${finalEnforcement.minimumAfterTarget.transfers} transf; ` +
          `pendências min com transf viável=${unenforcedMin.length}.`,
      );
    }

    if (ws.listCoverageGaps().length > 0) {
      const ctxFinal = ws.ensureRateioContext();
      repairAllCoverageGapsFinal(ws, ctxFinal);
      finalizeT8NdBlocks(ws);
      ws.syncRateioContext();
      enforceProportionalTurnTargets(ws);
    }

    const tailMinValidation = validateRateioMinimums(ws);
    if (tailMinValidation.issues.some((i) => i.hasValidTransfer)) {
      for (let clamp = 0; clamp < 32; clamp++) {
        if (!validateRateioMinimums(ws).issues.some((i) => i.hasValidTransfer)) break;
        const clampReport = enforceMinimumTurnTargets(ws);
        ws.syncRateioContext();
        if (clampReport.transfers === 0) break;
      }
    }

    const tailMinAfterClamp = validateRateioMinimums(ws);
    if (tailMinAfterClamp.issues.some((i) => i.hasValidTransfer)) {
      motorReport.warnings.push({
        severity: "ALTA",
        level: "WARNING",
        type: "RATEIO_MIN_UNENFORCED",
        date: "",
        employee: tailMinValidation.issues.map((i) => i.name).join(", "),
        detail: tailMinValidation.issues
          .filter((i) => i.hasValidTransfer)
          .map((i) => `${i.name}: ${i.transferHint ?? "transferência viável"}`)
          .join("; "),
      });
    }

    motorReport.structuralMetrics = buildStructuralMetrics(
      ws,
      ws.toAssignments(),
      motorReport.vacationBelowPattern,
    );
    motorReport.t8IsolatedCount = motorReport.structuralMetrics.isolatedT8Count;
    motorReport.t8PairsWithoutNdCount = motorReport.structuralMetrics.pairsWithoutNdCount;
    motorReport.emergencyIsolatedT8Count = finalCoverage.emergencyIsolated;
    motorReport.emergencyIsolatedT8Days = ws.listEmergencyIsolatedT8Days();
    motorReport.stepNotes.push(...finalCoverage.notes);
    motorReport.warnings.push(...finalCoverage.warnings);

    for (const w of balanceReport.warnings) {
      engineSuggestions.push(w.detail);
    }

    const saveWs = finalizeMinimumTurnTargetsForSave(ws, input);
    const assignments = saveWs.toAssignments();
    const ctx = saveWs.toScheduleContext();
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
      ...finalCoverage.gapViolations,
    ].filter((i) => {
      const k = `${i.type}|${i.date}|${i.employee}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const folgasPerPao: Record<string, number> = {};
    for (const c of ws.paoEmps) {
      folgasPerPao[c.employee.name] = ws.countRest(c.uuid);
    }

    const coverageGaps = saveWs.listCoverageGaps().length;
    if (coverageGaps === 0 && balanceReport.warnings.length > 0) {
      balanceReport.warnings = balanceReport.warnings.filter((w) => w.type !== "COBERTURA");
    }
    if (coverageGaps > 0) {
      engineSuggestions.push(
        `${coverageGaps} furo(s) de cobertura — revise equipe, bloqueios e blocos T8/T8/ND.`,
      );
    }
    if (!ws.realV1ManualCommonFolga) {
      for (const c of ws.paoEmps) {
        const n = folgasPerPao[c.employee.name];
        if (n < IDEAL_PAO_REST_COUNT) {
          engineSuggestions.push(
            `${c.employee.name}: ${n}/${IDEAL_PAO_REST_COUNT} folgas — revise carga do mês.`,
          );
        }
      }
    } else if (countAutoCommonFolgas(ws) > 0) {
      engineSuggestions.push(
        "Folga comum detectada após geração — deve ser alocada manualmente na escala visual.",
      );
    }

    const insights = buildGenerationInsights(
      ws,
      violations,
      { repaired: 0, remainingGaps: coverageGaps, suggestions: [] },
      engineSuggestions,
    );
    const generationMs = Math.round(performance.now() - startedAt);

    const summary = buildExtendedSummary(saveWs, violations, {
      totalAssignments: assignments.length,
      totalAllocations: saveWs.allocations.length,
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
      blockOptimizerMetrics: blockOptimizerReport.metrics,
    });

    return {
      assignments,
      allocations: saveWs.allocations,
      violations,
      summary,
      success: summary.valid,
      suggestions: insights.suggestions,
    };
  }
}

export function runFinalCoveragePipeline(
  ws: GenerationWorkspace,
): {
  notes: string[];
  warnings: RealMotorReport["warnings"];
  gapViolations: RealMotorReport["warnings"];
  emergencyIsolated: number;
  t8Optimization?: ReturnType<typeof optimizeEmergencyIsolatedT8>;
} {
  const notes: string[] = [];
  const warnings: RealMotorReport["warnings"] = [];
  const ctx = ws.ensureRateioContext();

  finalizeT8NdBlocks(ws);
  const dupes1 = deduplicatePaoShiftCoverage(ws);
  const t8Repair = repairT8GapsAfterDedup(ws);
  finalizeT8NdBlocks(ws);
  let repair1 = repairAllCoverageGapsFinal(ws, ctx);
  finalizeT8NdBlocks(ws);

  ws.syncRateioContext();
  enforceProportionalTurnTargets(ws);

  const preOptimizeSnapshot = captureOptimizationSnapshot(ws);
  let t8Optimization = optimizeEmergencyIsolatedT8(ws, ctx);

  let repair2 = repairAllCoverageGapsFinal(ws, ctx);
  finalizeT8NdBlocks(ws);
  const dupes2 = deduplicatePaoShiftCoverage(ws);
  let repair3 = repairAllCoverageGapsFinal(ws, ctx);
  finalizeT8NdBlocks(ws);

  let gapViolations = validateNoCoverageGaps(ws);

  if (gapViolations.length > 0) {
    restoreOptimizationSnapshot(ws, preOptimizeSnapshot);
    finalizeT8NdBlocks(ws);
    deduplicatePaoShiftCoverage(ws);
    repair1 = repairAllCoverageGapsFinal(ws, ctx);
    finalizeT8NdBlocks(ws);
    gapViolations = validateNoCoverageGaps(ws);

    t8Optimization = {
      isolatedBefore: t8Optimization.isolatedBefore,
      isolatedAfter: t8Optimization.isolatedBefore,
      converted: 0,
      rolledBack: true,
      rollbackReason: gapViolations[0]?.detail ?? "COBERTURA_GAP_POS_OTIMIZACAO",
      actions: [],
      unresolved: [],
    };
    notes.push(
      `[13c] Otimização T8 revertida — gap(s) persistiram após reparo pós-otimização.`,
    );
  }

  warnings.push(...t8Repair.warnings, ...repair1.warnings, ...repair2.warnings, ...repair3.warnings);

  const emergencyIsolated = t8Repair.emergencyIsolated + repair1.t8EmergencyIsolated +
    repair2.t8EmergencyIsolated + repair3.t8EmergencyIsolated;

  if (t8Optimization.converted > 0 && !t8Optimization.rolledBack) {
    notes.push(
      `[13b] T8 isolado: ${t8Optimization.isolatedBefore}→${t8Optimization.isolatedAfter} ` +
        `(${t8Optimization.converted} convertido(s) em bloco).`,
    );
  }

  notes.push(
    `[13] Pipeline cobertura final: dedup=${dupes1 + dupes2}; T8 blocos=${t8Repair.blocksPlaced}; ` +
      `T8 emerg=${t8Repair.emergencyIsolated}; reparo1 T6=${repair1.t6Filled} T7=${repair1.t7Filled} ` +
      `T8=${repair1.t8BlocksPlaced}+${repair1.t8EmergencyIsolated}; ` +
      `reparo pós-otim=${repair2.t6Filled + repair2.t7Filled + repair2.t8BlocksPlaced + repair2.t8EmergencyIsolated}; ` +
      `reparo pós-dedup=${repair3.t6Filled + repair3.t7Filled + repair3.t8BlocksPlaced + repair3.t8EmergencyIsolated}; ` +
      `T8 otim=${t8Optimization.isolatedBefore}→${t8Optimization.isolatedAfter}` +
      (t8Optimization.rolledBack ? " (revertida)" : "") +
      `; gaps=${gapViolations.length}.`,
  );

  if (gapViolations.length > 0) {
    notes.push(`[13] ATENÇÃO: ${gapViolations.length} furo(s) após reparo final.`);
  }

  return { notes, warnings, gapViolations, emergencyIsolated, t8Optimization };
}

export function closeStructurePreservingGaps(
  ws: GenerationWorkspace,
  repairEngine: ScheduleRepairEngine,
  stepNotes: string[],
  label: string,
  useCompleteAgenda: boolean,
): void {
  let rounds = 0;
  let totalRepaired = 0;

  while (ws.listCoverageGaps().length > 0 && rounds++ < 6) {
    const gapsBefore = ws.listCoverageGaps().length;
    closeT8CoverageGaps(ws);
    ws.coverT6T7Only();
    coverResidualT6T7Only(ws);
    const repair = repairEngine.repair(ws, []);
    totalRepaired += repair.repaired;
    ws.repairIsolatedT8();
    finalizeT8NdBlocks(ws);
    const gapsAfter = ws.listCoverageGaps().length;
    if (gapsAfter >= gapsBefore && repair.repaired === 0) break;
  }

  if (useCompleteAgenda && ws.listCoverageGaps().length > 0) {
    ws.completePaoAgenda();
    finalizeT8NdBlocks(ws);
  }

  if (totalRepaired > 0 || rounds > 1 || ws.listCoverageGaps().length > 0) {
    stepNotes.push(
      `${label} Fechamento cobertura: ${totalRepaired} reparo(s); gaps=${ws.listCoverageGaps().length}.`,
    );
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

/** Workspace no ponto imediatamente anterior ao enforceProportionalTurnTargets [11d]. */
export function prepareWorkspaceThroughPreV4Enforce(
  input: GenerationInput,
  engine: RealScheduleEngine = realScheduleEngine,
): GenerationWorkspace {
  const ws = new GenerationWorkspace(input);
  ws.realV1ManualCommonFolga = true;
  ws.applyHardBlocks();
  const motorReport = engine.execute(ws);

  operationalBalancer.balance(ws, [
    ...ws.birthdayWarnings,
    ...ws.noFlightWarnings,
    ...ws.monoFolgaWarnings,
    ...motorReport.warnings,
  ]);

  const stepNotes: string[] = [];
  if (ws.listCoverageGaps().length > 0) {
    closeStructurePreservingGaps(ws, new ScheduleRepairEngine(), stepNotes, "[10]", true);
  }
  ws.correctMonoFolgasPedidas();
  ws.repairIsolatedT8();
  ws.cleanupOrphanNd();
  ws.ensureNdForT8Pairs();
  motorReport.structuralMetrics = buildStructuralMetrics(
    ws,
    ws.toAssignments(),
    motorReport.vacationBelowPattern,
  );

  ws.correctMonoFolgasPedidas();
  const dupesRemoved = deduplicatePaoShiftCoverage(ws);
  if (dupesRemoved > 0) {
    closeStructurePreservingGaps(ws, new ScheduleRepairEngine(), stepNotes, "[11c]", true);
  }

  ws.correctMonoFolgasPedidas();
  ws.syncRateioContext();
  return ws;
}
