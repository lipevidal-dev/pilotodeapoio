import { computeTurnRateio, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";

export interface ResidualCoverageResult {
  gapsBefore: number;
  unitCoverageApplied: number;
  gapsAfter: number;
}

/** Etapa 7 — Cobertura unitária como último recurso (T6/T7/T8). */
export function coverResidualGaps(ws: GenerationWorkspace): ResidualCoverageResult {
  const gapsBefore = ws.listCoverageGaps().length;
  let unitCoverageApplied = 0;
  ws.ensureRateioContext();
  const rateioEntries = computeTurnRateio(ws).entries;

  for (let di = 0; di < ws.days.length; di++) {
    const day = ws.days[di]!;
    const candidates = sortPaoForCoverageCandidates(ws, di, rateioEntries);

    for (const code of ["T6", "T7"] as const) {
      if (ws.hasPaoCoverage(day, code)) continue;

      let placed = false;
      for (const c of candidates) {
        if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
        if (ws.tryAssignShift(c.uuid, day, code)) {
          unitCoverageApplied++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        for (const c of candidates) {
          if (ws.tryAssignShift(c.uuid, day, code, true)) {
            unitCoverageApplied++;
            break;
          }
        }
      }
    }
  }

  ws.planT8CoverageRotating();
  ws.coverT8BlocksOnly();
  ws.ensureNdForT8Pairs();

  return {
    gapsBefore,
    unitCoverageApplied,
    gapsAfter: ws.listCoverageGaps().length,
  };
}
