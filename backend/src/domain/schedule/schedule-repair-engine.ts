import { coverageRuleCode } from "./violation-level.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import { countPrimaryRateioTurns } from "./pao-rateio-shifts.js";
import { currentTurnCount } from "./schedule-rateio-context.js";
import { sortPaoForT8CoverageCandidates } from "./t8-coverage-priority.js";
import { sortCandidatesForRestrictedShiftBreak } from "./shift-restriction-sorting.js";

export interface RepairResult {
  repaired: number;
  remainingGaps: number;
  suggestions: string[];
}

const MAX_REPAIR_ROUNDS = 40;
const REPAIR_SHIFTS = ["T6", "T7", "T8"] as const;
const COVERAGE_GAP_SHIFT_ORDER: Record<string, number> = { T6: 0, T7: 1, T8: 2 };

function sortCoverageGapsForRepair(
  gaps: Array<{ date: string; shiftCode: string }>,
): Array<{ date: string; shiftCode: string }> {
  return [...gaps].sort(
    (a, b) =>
      (COVERAGE_GAP_SHIFT_ORDER[a.shiftCode] ?? 9) -
        (COVERAGE_GAP_SHIFT_ORDER[b.shiftCode] ?? 9) || a.date.localeCompare(b.date),
  );
}

function sortRepairCandidates(ws: GenerationWorkspace, shiftCode: string): GenerationInputEmployee[] {
  const ctx = ws.rateioContext;
  const sorted = [...ws.paoEmps].sort((a, b) => {
    if (ctx) {
      const curA = currentTurnCount(ctx, a.uuid);
      const curB = currentTurnCount(ctx, b.uuid);
      if (curA !== curB) return curA - curB;
    }
    return (
      countPrimaryRateioTurns(ws, a.uuid) - countPrimaryRateioTurns(ws, b.uuid) ||
      a.employee.seniority - b.employee.seniority
    );
  });
  return sortCandidatesForRestrictedShiftBreak(ws, sorted, shiftCode);
}

function tryAssignForCoverage(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: string,
): boolean {
  return ws.tryAssignShift(uuid, day, code) || ws.tryAssignShift(uuid, day, code, true);
}

/**
 * Repara furos de cobertura sem sobrescrever bloqueios ou criar T8 isolado.
 */
export class ScheduleRepairEngine {
  repair(ws: GenerationWorkspace, suggestions: string[]): RepairResult {
    let repaired = 0;
    const extraSuggestions: string[] = [];

    for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
      const gaps = sortCoverageGapsForRepair(ws.listCoverageGaps());
      if (gaps.length === 0) break;

      let fixedAny = false;
      for (const gap of gaps) {
        if (this.fixOneGap(ws, gap)) {
          repaired++;
          fixedAny = true;
          break;
        }
      }
      if (!fixedAny) break;
    }

    const remaining = ws.listCoverageGaps();
    for (const g of remaining) {
      extraSuggestions.push(
        `Pendência: ${coverageRuleCode(g.shiftCode)} em ${g.date} — nenhum PAO elegível após reparo.`,
      );
    }

    return {
      repaired,
      remainingGaps: remaining.length,
      suggestions: [...suggestions, ...extraSuggestions],
    };
  }

  private fixOneGap(
    ws: GenerationWorkspace,
    gap: { date: string; shiftCode: string },
  ): boolean {
    if (this.tryDirectFill(ws, gap.date, gap.shiftCode)) return true;

    for (const c of sortRepairCandidates(ws, gap.shiftCode)) {
      if (!ws.releaseOneGeneratorFolga(c.uuid, gap.date)) continue;
      if (gap.shiftCode === "T8") {
        if (ws.tryAssignT8Coverage(gap.date, [c], true)) return true;
      } else if (tryAssignForCoverage(ws, c.uuid, gap.date, gap.shiftCode)) {
        return true;
      }
    }

    return this.trySimpleSwap(ws, gap.date, gap.shiftCode);
  }

  private tryDirectFill(ws: GenerationWorkspace, day: string, code: string): boolean {
    if (code === "T8") {
      const dayIndex = Math.max(0, ws.days.indexOf(day));
      const candidates = sortPaoForT8CoverageCandidates(ws, dayIndex, true);
      return ws.tryAssignT8Coverage(day, candidates, true);
    }
    const candidates = sortRepairCandidates(ws, code);
    for (const c of candidates) {
      if (tryAssignForCoverage(ws, c.uuid, day, code)) return true;
    }
    return false;
  }

  /** Troca um PAO de outro turno do mesmo dia para liberar elegibilidade. */
  private trySimpleSwap(ws: GenerationWorkspace, day: string, missingCode: string): boolean {
    for (const c of ws.paoEmps) {
      const did = ws.uuidToDomain.get(c.uuid)!;
      for (const code of REPAIR_SHIFTS) {
        if (code === missingCode) continue;
        if (ws.planned.get(`${did}|${day}`) !== code) continue;

        ws.unassignShift(c.uuid, day);
        if (tryAssignForCoverage(ws, c.uuid, day, missingCode)) {
          if (this.tryDirectFill(ws, day, code)) return true;
          ws.unassignShift(c.uuid, day);
          ws.tryAssignShift(c.uuid, day, code);
        } else {
          ws.tryAssignShift(c.uuid, day, code);
        }
      }
    }
    return false;
  }
}

export const scheduleRepairEngine = new ScheduleRepairEngine();
