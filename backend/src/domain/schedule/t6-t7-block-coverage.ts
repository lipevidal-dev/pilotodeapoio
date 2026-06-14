import { addDays } from "../rules/dates.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import { blockLimitsForShift, type T6T7ShiftCode } from "./coverage-block-config.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { computeTurnRateio, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";

/** Tamanho do bloco T6/T7 se o turno for alocado em `day` (inclui dias já planejados). */
export function projectedT6T7BlockLength(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: string,
): number {
  if (code !== "T6" && code !== "T7") return 1;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return 1;

  const prev = addDays(day, -1);
  const back = ws.days.includes(prev)
    ? ws.countConsecutiveShiftEnding(uuid, code, prev)
    : 0;

  let forward = 0;
  let d = addDays(day, 1);
  while (ws.days.includes(d)) {
    const shift = ws.planned.get(`${did}|${d}`);
    if (shift !== code) break;
    forward++;
    d = addDays(d, 1);
  }
  return back + 1 + forward;
}

/** Impede blocos consecutivos acima do máximo (5) no mesmo turno T6/T7. */
export function wouldExceedT6T7BlockMax(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: string,
): boolean {
  if (code !== "T6" && code !== "T7") return false;
  const { max } = blockLimitsForShift(code);
  return projectedT6T7BlockLength(ws, uuid, day, code) > max;
}

function sortCoverageCandidates(
  ws: GenerationWorkspace,
  dayIndex: number,
): GenerationInputEmployee[] {
  ws.ensureRateioContext();
  const entries = computeTurnRateio(ws).entries;
  return sortPaoForCoverageCandidates(ws, dayIndex, entries);
}

function coverShiftByBlocks(ws: GenerationWorkspace, code: T6T7ShiftCode): number {
  const { max: blockMax } = blockLimitsForShift(code);
  let gaps = 0;
  let di = 0;

  while (di < ws.days.length) {
    const day = ws.days[di];
    if (ws.hasPaoCoverage(day, code)) {
      di++;
      continue;
    }

    const candidates = sortCoverageCandidates(ws, di);
    let placed = false;

    const prevDay = di > 0 ? ws.days[di - 1] : undefined;
    if (prevDay) {
      const prevUuid = ws.findPaoOnShift(prevDay, code);
      if (
        prevUuid &&
        !wouldExceedT6T7BlockMax(ws, prevUuid, day, code) &&
        ws.tryAssignShift(prevUuid, day, code)
      ) {
        di++;
        continue;
      }
    }

    for (const c of candidates) {
      if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
      if (!ws.tryAssignShift(c.uuid, day, code)) continue;

      let streak = 1;
      let nextDi = di + 1;
      while (streak < blockMax && nextDi < ws.days.length) {
        const nextDay = ws.days[nextDi];
        if (ws.hasPaoCoverage(nextDay, code)) break;
        if (wouldExceedT6T7BlockMax(ws, c.uuid, nextDay, code)) break;
        if (!ws.tryAssignShift(c.uuid, nextDay, code)) break;
        streak++;
        nextDi++;
      }

      placed = true;
      di = nextDi;
      break;
    }

    if (!placed) {
      for (const c of candidates) {
        if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
        if (ws.tryAssignShift(c.uuid, day, code)) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        for (const c of candidates) {
          if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
          if (ws.tryAssignShift(c.uuid, day, code, true)) {
            placed = true;
            break;
          }
        }
      }
      if (!placed) gaps++;
      di++;
    }
  }

  return gaps;
}

/** Cobertura T6/T7 priorizando blocos consecutivos (Fase 7.1). */
export function coverT6T7ByBlocks(
  ws: GenerationWorkspace,
  codes: readonly T6T7ShiftCode[] = ["T6", "T7"],
): number {
  let gaps = 0;
  for (const code of codes) {
    gaps += coverShiftByBlocks(ws, code);
  }
  return gaps;
}

/** Estratégia legada dia a dia — somente para comparação em testes. */
export function coverT6T7ByUnitDays(ws: GenerationWorkspace): number {
  let gaps = 0;
  for (let di = 0; di < ws.days.length; di++) {
    const day = ws.days[di];
    const rotated = sortCoverageCandidates(ws, di);
    for (const code of ["T6", "T7"] as const) {
      if (ws.hasPaoCoverage(day, code)) continue;
      let assigned = false;
      for (const c of rotated) {
        if (ws.tryAssignShift(c.uuid, day, code)) {
          assigned = true;
          break;
        }
      }
      if (!assigned) gaps++;
    }
  }
  return gaps;
}

export function longestConsecutiveRun(
  assignments: Array<{ employeeUuid: string; date: string; shiftCode: string }>,
  uuid: string,
  code: T6T7ShiftCode,
  monthDays: string[],
): number {
  const dates = assignments
    .filter((a) => a.employeeUuid === uuid && a.shiftCode === code)
    .map((a) => a.date)
    .sort((a, b) => monthDays.indexOf(a) - monthDays.indexOf(b));

  let best = 0;
  let current = 0;
  let prev: string | null = null;
  for (const d of dates) {
    if (prev && addDays(prev, 1) === d) {
      current++;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    prev = d;
  }
  return best;
}
