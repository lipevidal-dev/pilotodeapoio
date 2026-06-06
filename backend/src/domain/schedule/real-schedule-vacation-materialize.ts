import { addDays } from "../rules/dates.js";
import {
  hasVacationInMonth,
  isVacationDay,
  vacationDaysForPao,
} from "./pao-operational-priority.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { availableDaysOutsideVacation } from "./real-schedule-targets.js";
import {
  vacationPatternSequence,
  vacationPatternWorkTarget,
} from "./real-schedule-vacation-pattern.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import type { ValidationIssue } from "./types.js";

export type VacationFortnight = "FIRST_HALF" | "SECOND_HALF" | null;

export interface VacationFortnightBelowPattern {
  employeeUuid: string;
  name: string;
  fortnight: VacationFortnight;
  expectedWorkDays: number;
  actualWorkDays: number;
  reason?: string;
}

export interface VacationMaterializeResult {
  processedCount: number;
  workDaysPlaced: number;
  folgasPlaced: number;
  belowPattern: VacationFortnightBelowPattern[];
  warnings: ValidationIssue[];
}

/** Detecta férias concentradas na 1ª ou 2ª quinzena do mês. */
export function detectVacationFortnight(
  ws: GenerationWorkspace,
  uuid: string,
): VacationFortnight {
  if (!hasVacationInMonth(ws, uuid)) return null;

  const vac = vacationDaysForPao(ws, uuid);
  if (vac.length < 10) return null;

  const mid = Math.floor(ws.days.length / 2);
  const firstHalf = new Set(ws.days.slice(0, mid));
  const secondHalf = new Set(ws.days.slice(mid));

  const inFirst = vac.filter((d) => firstHalf.has(d)).length;
  const inSecond = vac.filter((d) => secondHalf.has(d)).length;

  if (inFirst >= 10 && inSecond <= 2) return "FIRST_HALF";
  if (inSecond >= 10 && inFirst <= 2) return "SECOND_HALF";
  return null;
}

function pickShiftForRun(ws: GenerationWorkspace, days: string[]): "T6" | "T7" {
  let t6Need = 0;
  let t7Need = 0;
  for (const day of days) {
    if (!ws.hasPaoCoverage(day, "T6")) t6Need++;
    if (!ws.hasPaoCoverage(day, "T7")) t7Need++;
  }
  return t7Need > t6Need ? "T7" : "T6";
}

function shiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

function materializeWorkRun(
  ws: GenerationWorkspace,
  uuid: string,
  days: string[],
): number {
  if (days.length === 0) return 0;

  const code = pickShiftForRun(ws, days);
  let placed = 0;

  for (const day of days) {
    if (isVacationDay(ws, uuid, day)) continue;
    if (ws.isDayBlockedForShift(uuid, day)) continue;
    if (shiftOnDay(ws, uuid, day)) continue;
    if (wouldExceedT6T7BlockMax(ws, uuid, day, code)) continue;
    if (ws.tryAssignShift(uuid, day, code) || ws.tryAssignShift(uuid, day, code, true)) {
      placed++;
    }
  }

  return placed;
}

function countWorkInAvailable(
  ws: GenerationWorkspace,
  uuid: string,
  available: string[],
): number {
  let n = 0;
  for (const day of available) {
    const code = shiftOnDay(ws, uuid, day);
    if (code === "T6" || code === "T7" || code === "T8") n++;
  }
  return n;
}

/**
 * Materializa padrão 3 trabalho / 2 folga no período disponível (férias quinzenais).
 * PAOs com férias quinzenais recebem prioridade antes dos PAOs normais.
 */
export function materializeVacationFortnightPatterns(
  ws: GenerationWorkspace,
): VacationMaterializeResult {
  const warnings: ValidationIssue[] = [];
  const belowPattern: VacationFortnightBelowPattern[] = [];
  let processedCount = 0;
  let workDaysPlaced = 0;
  let folgasPlaced = 0;

  const vacationPaos = [...ws.paoEmps]
    .filter((c) => detectVacationFortnight(ws, c.uuid) !== null)
    .sort((a, b) => a.employee.seniority - b.employee.seniority);

  for (const c of vacationPaos) {
    const fortnight = detectVacationFortnight(ws, c.uuid)!;
    const available = availableDaysOutsideVacation(ws, c.uuid);
    const seq = vacationPatternSequence(available.length);
    const expectedWork = vacationPatternWorkTarget(available.length);

    const workRuns: string[][] = [];
    let currentRun: string[] = [];

    for (let i = 0; i < available.length; i++) {
      const day = available[i]!;
      const kind = seq[i]!;

      if (kind === "F") {
        if (currentRun.length > 0) {
          workRuns.push(currentRun);
          currentRun = [];
        }
        if (ws.isPaoDayEmpty(c.uuid, day) && !isVacationDay(ws, c.uuid, day)) {
          ws.lockDay(c.uuid, day, "FOLGA");
          folgasPlaced++;
        }
      } else {
        currentRun.push(day);
      }
    }
    if (currentRun.length > 0) workRuns.push(currentRun);

    let placedInRun = 0;
    for (const run of workRuns) {
      placedInRun += materializeWorkRun(ws, c.uuid, run);
    }
    workDaysPlaced += placedInRun;
    processedCount++;

    const actualWork = countWorkInAvailable(ws, c.uuid, available);
    if (actualWork < expectedWork) {
      const blocked = available.filter(
        (d) => ws.isDayBlockedForShift(c.uuid, d) && !isVacationDay(ws, c.uuid, d),
      ).length;

      const entry: VacationFortnightBelowPattern = {
        employeeUuid: c.uuid,
        name: c.employee.name,
        fortnight,
        expectedWorkDays: expectedWork,
        actualWorkDays: actualWork,
        reason:
          blocked > 0
            ? `${blocked} dia(s) bloqueado(s) no período disponível.`
            : "Cobertura ou restrições impediram o padrão 3/2.",
      };
      belowPattern.push(entry);

      warnings.push({
        severity: "MÉDIA",
        level: "WARNING",
        type: "FÉRIAS QUINZENAIS",
        date: available[0] ?? "",
        employee: c.employee.name,
        detail: `Padrão 3/2 incompleto: ${actualWork}/${expectedWork} dias de trabalho no período ${
          fortnight === "FIRST_HALF" ? "16–fim" : "01–15"
        }. ${entry.reason}`,
      });
    }
  }

  return {
    processedCount,
    workDaysPlaced,
    folgasPlaced,
    belowPattern,
    warnings,
  };
}

/** Verifica se PAO tem turno ativo no dia (T6/T7/T8). */
export function hasActiveShiftOnDay(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  const code = shiftOnDay(ws, uuid, day);
  return code === "T6" || code === "T7" || code === "T8";
}

/** Dias consecutivos de trabalho no período disponível (para validação 3/2). */
export function longestWorkStreakInAvailable(
  ws: GenerationWorkspace,
  uuid: string,
  available: string[],
): number {
  let best = 0;
  let current = 0;
  let prev: string | null = null;

  for (const day of available) {
    if (!hasActiveShiftOnDay(ws, uuid, day)) {
      current = 0;
      prev = null;
      continue;
    }
    if (prev && addDays(prev, 1) === day) {
      current++;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    prev = day;
  }
  return best;
}
