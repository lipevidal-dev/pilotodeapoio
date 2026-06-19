import { materializeBlockPlans } from "./demand-planning-materialize.js";
import type { IndividualTarget } from "./demand-planning-types.js";
import { isParallelOnlyPreferredPao, isT8PreferredPao } from "./employee-t6-t7-shift.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { analyzeT6T7BlockCoverage } from "./coverage-block-metrics.js";
import type { GeneratedAssignment } from "../generation-types.js";
import {
  V3BlockMaterializeAuditCollector,
  type V3BlockMaterializeAudit,
} from "./v3-block-materialize-audit.js";
import {
  buildFeasibilityMetrics,
  buildFeasibleBlockPlans,
  type V3FeasibilityMetrics,
} from "./v3-feasibility-planning.js";

export interface MaterializeBlocksStrictResult {
  placedBlocks: number;
  failedBlocks: number;
  placedShifts: number;
  unitPlacements: number;
  blockSizesPlaced: number[];
  blockPlans: ReturnType<typeof buildFeasibleBlockPlans>;
  v3BlockMaterializeAudit: V3BlockMaterializeAudit;
  feasibility: V3FeasibilityMetrics;
}

/**
 * Materializa T6/T7 em blocos consecutivos (Motor V3: Bf=4/5, espaçamento Xf).
 * Planejamento de viabilidade V3 — só blocos simuláveis entram em plannedBlocks.
 */
export function materializeT6T7BlocksStrict(
  ws: GenerationWorkspace,
  targets: IndividualTarget[],
): MaterializeBlocksStrictResult {
  const eligible = targets.filter((t) => {
    if (t.group === "VACATION" || t.target <= 0) return false;
    if (isParallelOnlyPreferredPao(ws, t.employeeUuid)) return false;
    if (isT8PreferredPao(ws, t.employeeUuid)) return false;
    return true;
  });
  const plans = buildFeasibleBlockPlans(ws, eligible);
  const auditCollector = new V3BlockMaterializeAuditCollector();
  const result = materializeBlockPlans(ws, plans, { audit: auditCollector });
  const coverage = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
  const blockSizesPlaced = plans.flatMap((p) =>
    p.executedBlocks.map((b) => b.size),
  );
  const discardedBlockShifts = plans.reduce((n, plan) => {
    const planned = plan.plannedBlocks.reduce((s, b) => s + b.size, 0);
    const executed = plan.executedBlocks.reduce((s, b) => s + b.size, 0);
    return n + Math.max(0, planned - executed);
  }, 0);

  return {
    placedBlocks: result.placedBlocks,
    failedBlocks: result.failedBlocks,
    placedShifts: result.placedShifts,
    unitPlacements: coverage.unitCoverageTotal,
    blockSizesPlaced,
    blockPlans: plans,
    v3BlockMaterializeAudit: auditCollector.buildReport(),
    feasibility: buildFeasibilityMetrics(plans, result.placedShifts, discardedBlockShifts),
  };
}

/** Métricas de blocos T6/T7 a partir das alocações finais. */
export function analyzeStructuralT6T7Blocks(
  assignments: GeneratedAssignment[],
  monthDays: string[],
) {
  return analyzeT6T7BlockCoverage(assignments, monthDays);
}
