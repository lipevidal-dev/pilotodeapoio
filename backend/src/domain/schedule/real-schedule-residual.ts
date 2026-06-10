import type { GenerationWorkspace } from "./generation-workspace.js";
import { MIN_MONTHLY_FOLGAS } from "./real-schedule-types.js";
import { computeTurnRateio, sortPaoForTurnBalance } from "./real-schedule-turn-rateio.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";

function shouldReserveDaysForFolgas(ws: GenerationWorkspace, uuid: string): boolean {
  const rest = ws.countRest(uuid);
  if (rest >= MIN_MONTHLY_FOLGAS) return false;
  const need = MIN_MONTHLY_FOLGAS - rest;
  return ws.emptyDaysForPao(uuid).length <= need + 1;
}

export interface ResidualT6T7Result {
  gapsBefore: number;
  blockCoverageApplied: number;
  unitCoverageApplied: number;
  gapsAfter: number;
}

/** Prioridade de bloco: 4 → 5 → 3 (6 excede máximo operacional de 5). */
const BLOCK_TRY_SIZES = [4, 5, 3] as const;

function gapNeedsCode(ws: GenerationWorkspace, day: string, code: "T6" | "T7"): boolean {
  return !ws.hasPaoCoverage(day, code);
}

function tryPlaceResidualBlock(
  ws: GenerationWorkspace,
  startDi: number,
  code: "T6" | "T7",
  size: number,
  candidates: ReturnType<typeof sortPaoForTurnBalance>,
): boolean {
  if (startDi + size > ws.days.length) return false;

  for (let i = 0; i < size; i++) {
    const day = ws.days[startDi + i]!;
    if (!gapNeedsCode(ws, day, code)) return false;
  }

  for (const c of candidates) {
    if (shouldReserveDaysForFolgas(ws, c.uuid)) continue;

    let placed = 0;
    for (let i = 0; i < size; i++) {
      const day = ws.days[startDi + i]!;
      if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) {
        for (let j = 0; j < placed; j++) {
          ws.unassignShift(c.uuid, ws.days[startDi + j]!);
        }
        placed = -1;
        break;
      }
      if (!ws.tryAssignShift(c.uuid, day, code)) {
        for (let j = 0; j < placed; j++) {
          ws.unassignShift(c.uuid, ws.days[startDi + j]!);
        }
        placed = -1;
        break;
      }
      placed++;
    }

    if (placed === size) return true;
  }

  return false;
}

/**
 * Cobertura residual T6/T7 — blocos 4→5→3 antes de unitário.
 * Respeita equilíbrio de turnos: não força PAO acima da meta; lacunas permanecem.
 */
export function coverResidualT6T7Only(ws: GenerationWorkspace): ResidualT6T7Result {
  const gapsBefore = ws.listCoverageGaps().length;
  let blockCoverageApplied = 0;
  let unitCoverageApplied = 0;

  for (const code of ["T6", "T7"] as const) {
    let di = 0;
    while (di < ws.days.length) {
      const day = ws.days[di]!;
      if (!gapNeedsCode(ws, day, code)) {
        di++;
        continue;
      }

      const rateio = computeTurnRateio(ws);
      const candidates = sortPaoForTurnBalance(ws, di, rateio.entries);
      let placed = false;

      for (const size of BLOCK_TRY_SIZES) {
        if (tryPlaceResidualBlock(ws, di, code, size, candidates)) {
          blockCoverageApplied += size;
          di += size;
          placed = true;
          break;
        }
      }

      if (placed) continue;

      for (const c of candidates) {
        if (shouldReserveDaysForFolgas(ws, c.uuid)) continue;
        if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
        if (ws.tryAssignShift(c.uuid, day, code)) {
          unitCoverageApplied++;
          break;
        }
      }

      di++;
    }
  }

  return {
    gapsBefore,
    blockCoverageApplied,
    unitCoverageApplied,
    gapsAfter: ws.listCoverageGaps().length,
  };
}
