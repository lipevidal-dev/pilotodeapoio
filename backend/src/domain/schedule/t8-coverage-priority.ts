import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { preferenceScoreForShift, targetTurnDeficit } from "./preference-scoring.js";
import { sortPaoByOperationalPriority } from "./pao-operational-priority.js";
import { comparePaoPoolSeniority } from "./pao-pool-seniority.js";
import {
  currentTurnCount,
  isBelowMaxTurns,
  isBelowMinTurns,
  type ScheduleRateioContext,
} from "./schedule-rateio-context.js";
import { sortCandidatesForRestrictedShiftBreak } from "./shift-restriction-sorting.js";
import { employeeCanStartT8Block } from "./t8-block-limits.js";

/** Desempate T8: preferência T8 → senioridade ponderada → rateio → turnos totais. */
export function comparePaoForT8Coverage(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  a: GenerationInputEmployee,
  b: GenerationInputEmployee,
): number {
  const wantsT8A = ctx.preferredShiftByEmployee.get(a.uuid) === "T8";
  const wantsT8B = ctx.preferredShiftByEmployee.get(b.uuid) === "T8";
  if (wantsT8A !== wantsT8B) return wantsT8A ? -1 : 1;

  if (wantsT8A && wantsT8B) {
    const scoreA = preferenceScoreForShift(ws, ctx, a.uuid, "T8");
    const scoreB = preferenceScoreForShift(ws, ctx, b.uuid, "T8");
    if (scoreA !== scoreB) return scoreB - scoreA;
  }

  const belowMinA = isBelowMinTurns(ctx, a.uuid) ? 0 : 1;
  const belowMinB = isBelowMinTurns(ctx, b.uuid) ? 0 : 1;
  if (belowMinA !== belowMinB) return belowMinA - belowMinB;

  const targetDefA = targetTurnDeficit(ctx, a.uuid);
  const targetDefB = targetTurnDeficit(ctx, b.uuid);
  if (targetDefA !== targetDefB) return targetDefB - targetDefA;

  const curA = currentTurnCount(ctx, a.uuid);
  const curB = currentTurnCount(ctx, b.uuid);
  if (curA !== curB) return curA - curB;

  if (a.employee.seniority !== b.employee.seniority) {
    return comparePaoPoolSeniority(a, b);
  }
  return a.uuid.localeCompare(b.uuid);
}

/** Candidatos elegíveis para cobertura T8 — sem obrigar T8 mínimo por PAO. */
export function sortPaoForT8CoverageCandidates(
  ws: GenerationWorkspace,
  dayIndex: number,
  coverageEmergency = false,
): GenerationInputEmployee[] {
  const ctx = ws.ensureRateioContext();
  const base = sortPaoByOperationalPriority(ws, dayIndex).filter(
    (c) =>
      !isParallelOnlyPreferredPao(ws, c.uuid) &&
      employeeCanStartT8Block(ws, c.uuid, coverageEmergency) &&
      (coverageEmergency || isBelowMaxTurns(ctx, c.uuid)),
  );
  return sortCandidatesForRestrictedShiftBreak(
    ws,
    [...base].sort((a, b) => comparePaoForT8Coverage(ws, ctx, a, b)),
    "T8",
  );
}
