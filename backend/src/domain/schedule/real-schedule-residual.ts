import type { GenerationWorkspace } from "./generation-workspace.js";
import { MIN_MONTHLY_FOLGAS } from "./real-schedule-types.js";
import { computeTurnRateio, sortPaoForTurnBalance } from "./real-schedule-turn-rateio.js";
import { idealBlockSizeForTarget } from "./motor-v3-planning.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import { isParallelOnlyPreferredPao, isT8PreferredPao, employeeDominantT6T7OrResolve } from "./employee-t6-t7-shift.js";

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

/** Prioridade de bloco V3: Bf=5 → Bf=4 → 3. */
function residualBlockSizesForEmployee(ws: GenerationWorkspace, uuid: string): readonly number[] {
  const rateio = computeTurnRateio(ws);
  const entry = rateio.entries.find((e) => e.employeeUuid === uuid);
  const yf = entry?.turnTarget ?? 20;
  const bf = idealBlockSizeForTarget(yf);
  return bf === 5 ? ([5, 4, 3] as const) : ([4, 5, 3] as const);
}

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

  const gapDays = ws.days.slice(startDi, startDi + size);

  for (let i = 0; i < size; i++) {
    const day = ws.days[startDi + i]!;
    if (!gapNeedsCode(ws, day, code)) return false;
  }

  const ordered = [...candidates].sort((a, b) => {
    const codeA = employeeDominantT6T7OrResolve(ws, a.uuid, gapDays);
    const codeB = employeeDominantT6T7OrResolve(ws, b.uuid, gapDays);
    const matchA = codeA === code ? 0 : 1;
    const matchB = codeB === code ? 0 : 1;
    return matchA - matchB;
  });

  for (const c of ordered) {
    if (isParallelOnlyPreferredPao(ws, c.uuid)) continue;
    if (isT8PreferredPao(ws, c.uuid)) continue;
    const employeeCode = employeeDominantT6T7OrResolve(ws, c.uuid, gapDays);
    if (employeeCode !== code) continue;
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
      if (!ws.tryAssignShift(c.uuid, day, code) && !ws.tryAssignShift(c.uuid, day, code, true)) {
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

      const blockSizes = candidates.length > 0
        ? residualBlockSizesForEmployee(ws, candidates[0]!.uuid)
        : ([5, 4, 3] as const);

      for (const size of blockSizes) {
        if (tryPlaceResidualBlock(ws, di, code, size, candidates)) {
          blockCoverageApplied += size;
          di += size;
          placed = true;
          break;
        }
      }

      if (placed) continue;

      for (const c of candidates) {
        if (isParallelOnlyPreferredPao(ws, c.uuid)) continue;
        if (isT8PreferredPao(ws, c.uuid)) continue;
        if (shouldReserveDaysForFolgas(ws, c.uuid)) continue;
        const gapDay = ws.days[di]!;
        const employeeCode = employeeDominantT6T7OrResolve(ws, c.uuid, [gapDay]);
        if (employeeCode !== code) continue;
        if (wouldExceedT6T7BlockMax(ws, c.uuid, gapDay, code)) continue;
        if (ws.tryAssignShift(c.uuid, gapDay, code, true)) {
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
