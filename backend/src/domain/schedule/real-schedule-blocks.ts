import { buildBlockPlans } from "./demand-planning-blocks.js";
import { materializeBlockPlans } from "./demand-planning-materialize.js";
import type { IndividualTarget } from "./demand-planning-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { analyzeT6T7BlockCoverage } from "./coverage-block-metrics.js";
import type { GeneratedAssignment } from "./generation-types.js";

export interface MaterializeBlocksStrictResult {
  placedBlocks: number;
  failedBlocks: number;
  placedShifts: number;
  unitPlacements: number;
  blockSizesPlaced: number[];
}

/**
 * Materializa T6/T7 em blocos consecutivos (Motor V3: Bf=4/5, espaçamento Xf).
 * PAOs VACATION já materializados são excluídos (padrão 3/2 aplicado antes).
 */
export function materializeT6T7BlocksStrict(
  ws: GenerationWorkspace,
  targets: IndividualTarget[],
): MaterializeBlocksStrictResult {
  const eligible = targets.filter((t) => t.group !== "VACATION" && t.target > 0);
  const plans = buildBlockPlans(eligible);
  const result = materializeBlockPlans(ws, plans);
  const coverage = analyzeT6T7BlockCoverage(ws.toAssignments(), ws.days);
  const blockSizesPlaced = plans.flatMap((p) =>
    p.executedBlocks.map((b) => b.size),
  );

  return {
    placedBlocks: result.placedBlocks,
    failedBlocks: result.failedBlocks,
    placedShifts: result.placedShifts,
    unitPlacements: coverage.unitCoverageTotal,
    blockSizesPlaced,
  };
}

/** Métricas de blocos T6/T7 a partir das alocações finais. */
export function analyzeStructuralT6T7Blocks(
  assignments: GeneratedAssignment[],
  monthDays: string[],
) {
  return analyzeT6T7BlockCoverage(assignments, monthDays);
}
