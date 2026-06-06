import type { GeneratedAssignment } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { analyzeT6T7BlockCoverage } from "./coverage-block-metrics.js";
import { auditStructuralT8 } from "./real-schedule-t8.js";
import type { VacationFortnightBelowPattern } from "./real-schedule-vacation-materialize.js";

export interface RealStructuralMetrics {
  t6Blocks: number;
  t7Blocks: number;
  t6UnitCoverage: number;
  t7UnitCoverage: number;
  t6AverageBlockSize: number;
  t7AverageBlockSize: number;
  t8BlocksCount: number;
  isolatedT8Count: number;
  pairsWithoutNdCount: number;
  vacationBelowPatternCount: number;
  vacationBelowPattern: VacationFortnightBelowPattern[];
}

export function buildStructuralMetrics(
  ws: GenerationWorkspace,
  assignments: GeneratedAssignment[],
  vacationBelowPattern: VacationFortnightBelowPattern[] = [],
): RealStructuralMetrics {
  const t8Audit = auditStructuralT8(ws);
  const blockCoverage = analyzeT6T7BlockCoverage(assignments, ws.days);

  return {
    t6Blocks: blockCoverage.T6.blockCount,
    t7Blocks: blockCoverage.T7.blockCount,
    t6UnitCoverage: blockCoverage.T6.unitCoverageCount,
    t7UnitCoverage: blockCoverage.T7.unitCoverageCount,
    t6AverageBlockSize: blockCoverage.T6.averageBlockSize,
    t7AverageBlockSize: blockCoverage.T7.averageBlockSize,
    t8BlocksCount: t8Audit.t8BlocksCount,
    isolatedT8Count: t8Audit.isolatedT8Count,
    pairsWithoutNdCount: t8Audit.pairsWithoutNdCount,
    vacationBelowPatternCount: vacationBelowPattern.length,
    vacationBelowPattern,
  };
}
