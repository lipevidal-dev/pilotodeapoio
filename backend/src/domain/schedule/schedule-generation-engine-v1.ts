import { validateSchedule } from "../rules/engine.js";
import { runFinalCoverageGate } from "../rules/coverage-gate.js";
import { IDEAL_PAO_REST_COUNT } from "../rules/constants.js";
import { buildGenerationInsights } from "./generation-insights.js";
import { buildExtendedSummary } from "./generation-summary.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { ScheduleRepairEngine } from "./schedule-repair-engine.js";
import type { GenerationInput, GenerationResult } from "./generation-types.js";

/**
 * Backup do motor de geração (snapshot V1).
 * Preservado em 2026-06-05 antes de futuras reescritas — não evoluir este arquivo.
 * @see docs/motor-v1-backup.md
 */
export class ScheduleGenerationEngineV1 {
  constructor(private readonly repairEngine = new ScheduleRepairEngine()) {}

  generate(input: GenerationInput): GenerationResult {
    const startedAt = performance.now();
    const ws = new GenerationWorkspace(input);
    const engineSuggestions: string[] = [];

    ws.applyHardBlocks();
    ws.preallocatePaoFolgasBeforeCoverage();
    ws.planFolgaSocial();
    ws.planT8CoverageRotating();

    ws.coverT6T7Only();
    ws.coverT8BlocksOnly();

    ws.assignApaoWithPao();
    ws.allocateApaoRestDays();

    ws.allocatePaoRestDaysAfterCoverage();
    ws.ensureExactTenFolgasPerPao();
    ws.finalizePaoFolgaCounts();

    ws.planT8CoverageRotating();
    ws.coverT8BlocksOnly();
    ws.ensureNdForT8Pairs();

    ws.fillUnclassifiedPaoDays();

    const repair = this.repairEngine.repair(ws, engineSuggestions);
    ws.coverT6T7Only();
    ws.coverT8BlocksOnly();
    ws.repairIsolatedT8();
    ws.cleanupOrphanNd();
    ws.ensureNdForT8Pairs();

    ws.completePaoAgenda();
    ws.coverT6T7Only();
    ws.coverT8BlocksOnly();
    ws.assignApaoWithPao();
    ws.completeApaoAgenda();
    ws.enforceApaoSixByOne();
    ws.allocateApaoRestDays();

    this.repairEngine.repair(ws, engineSuggestions);
    ws.coverT6T7Only();
    ws.coverT8BlocksOnly();
    ws.ensureNdForT8Pairs();

    const assignments = ws.toAssignments();
    const ctx = ws.toScheduleContext();
    const engineViolations = validateSchedule(ctx);
    const gate = runFinalCoverageGate(ctx);

    const seen = new Set<string>();
    const violations = [...ws.birthdayWarnings, ...engineViolations, ...gate.issues].filter((i) => {
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

    const insights = buildGenerationInsights(ws, violations, repair, engineSuggestions);
    const generationMs = Math.round(performance.now() - startedAt);

    const summary = buildExtendedSummary(ws, violations, {
      totalAssignments: assignments.length,
      totalAllocations: ws.allocations.length,
      paoCount: ws.paoEmps.length,
      apaoCount: ws.apaoEmps.length,
      folgasPerPao,
      coverageGaps,
      repairsApplied: repair.repaired,
      repairRemainingGaps: repair.remainingGaps,
      generationMs,
      impossibleScenario: insights.impossibleScenario,
      mainBlockingReasons: insights.mainBlockingReasons,
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

export const scheduleGenerationEngineV1 = new ScheduleGenerationEngineV1();
