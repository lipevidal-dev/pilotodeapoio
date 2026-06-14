import { computeTurnRateio, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";
import { tryRepairT8GapWithBlock } from "./repair-t8-gaps-after-dedup.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";

export interface FinalCoverageRepairAudit {
  t6Filled: number;
  t7Filled: number;
  t8BlocksPlaced: number;
  t8EmergencyIsolated: number;
  overflowEvents: number;
  gapsRemaining: number;
  warnings: ValidationIssue[];
}

function wouldDuplicateT8Coverage(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  const holder = ws.findPaoOnShift(day, "T8");
  return holder != null && holder !== uuid;
}

function tryFillT6T7Gap(
  ws: GenerationWorkspace,
  day: string,
  code: "T6" | "T7",
  dayIndex: number,
): boolean {
  if (ws.hasPaoCoverage(day, code)) return true;

  const entries = computeTurnRateio(ws).entries;
  const candidates = sortPaoForCoverageCandidates(ws, dayIndex, entries);

  for (const c of candidates) {
    if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
    if (ws.isDayBlockedForShift(c.uuid, day)) continue;
    if (ws.tryAssignShift(c.uuid, day, code)) return true;
  }

  for (const c of candidates) {
    if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
    if (ws.isDayBlockedForShift(c.uuid, day)) continue;
    if (ws.tryAssignShift(c.uuid, day, code, true)) return true;
  }

  for (const c of ws.paoEmps) {
    if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;
    if (ws.isDayBlockedForShift(c.uuid, day)) continue;
    if (ws.tryAssignShift(c.uuid, day, code, true)) return true;
  }

  return ws.hasPaoCoverage(day, code);
}

function tryEmergencyIsolatedT8(
  ws: GenerationWorkspace,
  gapDay: string,
  warnings: ValidationIssue[],
): boolean {
  if (ws.hasPaoCoverage(gapDay, "T8")) return true;

  const dayIndex = Math.max(0, ws.days.indexOf(gapDay));
  const entries = computeTurnRateio(ws).entries;
  const candidates = sortPaoForCoverageCandidates(ws, dayIndex, entries).filter(
    (c) => !isParallelOnlyPreferredPao(ws, c.uuid),
  );

  const tryPool = [
    ...candidates,
    ...ws.paoEmps.filter(
      (c) =>
        !isParallelOnlyPreferredPao(ws, c.uuid) &&
        !candidates.some((x) => x.uuid === c.uuid),
    ),
  ];

  for (const c of tryPool) {
    if (wouldDuplicateT8Coverage(ws, c.uuid, gapDay)) continue;
    if (ws.isDayBlockedForShift(c.uuid, gapDay)) continue;
    if (!ws.tryAssignShift(c.uuid, gapDay, "T8", true)) continue;

    ws.markEmergencyIsolatedT8(c.uuid, gapDay);
    warnings.push({
      severity: "MÉDIA",
      level: "WARNING",
      type: "RATEIO_T8_EMERGENCY_ISOLATED",
      date: gapDay,
      employee: c.employee.name,
      detail:
        `T8 isolado emergencial em ${gapDay} para ${c.employee.name} — ` +
        "bloco T8/T8/ND impossível; cobertura final garantida.",
    });
    return true;
  }

  return false;
}

/**
 * Reparo hard final — cobertura T6/T7/T8 tem prioridade absoluta sobre rateio.
 * Pode usar overflow emergencial auditado; nunca deixa T8 em branco se houver fallback.
 */
export function repairAllCoverageGapsFinal(
  ws: GenerationWorkspace,
  _ctx: ScheduleRateioContext,
): FinalCoverageRepairAudit {
  ws.ensureRateioContext();
  const warnings: ValidationIssue[] = [];
  let t6Filled = 0;
  let t7Filled = 0;
  let t8BlocksPlaced = 0;
  let t8EmergencyIsolated = 0;
  const overflowBefore = ws.rateioContext!.overflowEvents.length;

  for (let pass = 0; pass < 6; pass++) {
    let progress = false;
    const gaps = [...ws.listCoverageGaps()];

    for (const gap of gaps) {
      const dayIndex = Math.max(0, ws.days.indexOf(gap.date));

      if (gap.shiftCode === "T8") {
        if (ws.hasPaoCoverage(gap.date, "T8")) continue;

        const before = ws.toAssignments().length;
        if (tryRepairT8GapWithBlock(ws, gap.date) && ws.hasPaoCoverage(gap.date, "T8")) {
          if (ws.toAssignments().length > before) t8BlocksPlaced++;
          progress = true;
          continue;
        }

        if (tryEmergencyIsolatedT8(ws, gap.date, warnings)) {
          t8EmergencyIsolated++;
          progress = true;
        }
        continue;
      }

      if (gap.shiftCode === "T6" || gap.shiftCode === "T7") {
        if (ws.hasPaoCoverage(gap.date, gap.shiftCode)) continue;
        if (tryFillT6T7Gap(ws, gap.date, gap.shiftCode, dayIndex)) {
          if (gap.shiftCode === "T6") t6Filled++;
          else t7Filled++;
          progress = true;
        }
      }
    }

    ws.syncRateioContext();
    if (!progress) break;
  }

  return {
    t6Filled,
    t7Filled,
    t8BlocksPlaced,
    t8EmergencyIsolated,
    overflowEvents: ws.rateioContext!.overflowEvents.length - overflowBefore,
    gapsRemaining: ws.listCoverageGaps().length,
    warnings,
  };
}

/** Valida ausência de gaps T6/T7/T8 — retorna issues CRITICAL se persistirem. */
export function validateNoCoverageGaps(ws: GenerationWorkspace): ValidationIssue[] {
  return ws.listCoverageGaps().map((g) => ({
    severity: "ALTA",
    level: "CRITICAL",
    type: "COBERTURA_GAP",
    date: g.date,
    employee: "",
    detail: `Furo de cobertura ${g.shiftCode} em ${g.date} após reparo final.`,
  }));
}
