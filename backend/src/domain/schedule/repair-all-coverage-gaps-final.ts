import { computeTurnRateio, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";
import { sortPaoForT8CoverageCandidates } from "./t8-coverage-priority.js";
import { tryRepairT6T7GapBlockedByPriorT8 } from "./repair-t6-t7-prior-t8.js";
import { tryRepairT8GapWithBlock } from "./repair-t8-gaps-after-dedup.js";
import { sortCandidatesForRestrictedShiftBreak } from "./shift-restriction-sorting.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import { finalizeT8NdBlocks, isNdDayAfterOwnT8Pair } from "./schedule-grid-source.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { ValidationIssue } from "./types.js";
import { assignmentKey } from "./types.js";
import {
  recordV5RepairPreferenceDilution,
  repairPreferenceTier,
  shouldDeferV5RepairNonPreferred,
  sortPaoForV5RepairCoverage,
  sortPaoForV5RepairT8Coverage,
  summarizeMatchingFailuresForRepair,
  tryV5RepairAssignOnGap,
} from "./v5-repair-preference.js";
import { validateMergePreservesMinimumLock } from "./v5-minimum-lock.js";

const MAX_COVERAGE_REPAIR_PASSES = 4;
const MAX_BEFORE_SAVE_PASSES = 3;

function allocationDedupeKey(row: { employeeUuid: string; date: string; label: string }): string {
  return `${row.employeeUuid}|${row.date}|${normalizeOperationalLabel(row.label).toUpperCase()}`;
}

function dedupeAllocations<T extends { employeeUuid: string; date: string; label: string }>(
  rows: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = allocationDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export interface FinalCoverageRepairAudit {
  t6Filled: number;
  t7Filled: number;
  t8BlocksPlaced: number;
  t8EmergencyIsolated: number;
  overflowEvents: number;
  gapsRemaining: number;
  warnings: ValidationIssue[];
}

export interface PersistCoverageRepairResult extends FinalCoverageRepairAudit {
  persistAssignments?: Array<{ employeeUuid: string; date: string; shiftCode: string }>;
  persistAllocations?: Array<{
    employeeUuid: string;
    date: string;
    label: string;
    startTime?: string;
    endTime?: string;
  }>;
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
  warnings: ValidationIssue[],
): boolean {
  if (ws.hasPaoCoverage(day, code)) return true;

  const entries = computeTurnRateio(ws).entries;

  const tryOne = (uuid: string, emergency: boolean): boolean => {
    if (wouldExceedT6T7BlockMax(ws, uuid, day, code)) return false;
    if (ws.isDayBlockedForShift(uuid, day)) return false;
    return ws.tryAssignShift(uuid, day, code, emergency);
  };

  if (ws.v5RepairPreferenceStrict) {
    const normal = tryV5RepairAssignOnGap(
      ws,
      day,
      code,
      dayIndex,
      false,
      warnings,
      (uuid) => tryOne(uuid, false),
    );
    if (normal.placed) return true;

    if (
      tryRepairT6T7GapBlockedByPriorT8(ws, day, code, dayIndex, (w, d, shift, di) => {
        if (w.v5RepairPreferenceStrict) {
          const attempt = tryV5RepairAssignOnGap(
            w,
            d,
            shift,
            di,
            false,
            warnings,
            (uuid) => {
              if (wouldExceedT6T7BlockMax(w, uuid, d, shift)) return false;
              if (w.isDayBlockedForShift(uuid, d)) return false;
              return w.tryAssignShift(uuid, d, shift);
            },
          );
          return attempt.placed || w.hasPaoCoverage(d, shift);
        }
        const pool = sortPaoForCoverageCandidates(w, di, entries, shift);
        for (const cand of pool) {
          if (wouldExceedT6T7BlockMax(w, cand.uuid, d, shift)) continue;
          if (w.isDayBlockedForShift(cand.uuid, d)) continue;
          if (w.tryAssignShift(cand.uuid, d, shift)) return true;
        }
        return w.hasPaoCoverage(d, shift);
      })
    ) {
      return true;
    }

    const emergency = tryV5RepairAssignOnGap(
      ws,
      day,
      code,
      dayIndex,
      true,
      warnings,
      (uuid) => tryOne(uuid, true),
    );
    if (emergency.placed) return true;

    const ctx = ws.ensureRateioContext();
    const entriesForBreak = computeTurnRateio(ws).entries;
    const breakCandidates = sortPaoForV5RepairCoverage(ws, dayIndex, entriesForBreak, code);
    for (const tier of [0, 1, 2] as const) {
      for (const c of breakCandidates) {
        if (repairPreferenceTier(ctx, c.uuid, code) !== tier) continue;
        if (shouldDeferV5RepairNonPreferred(ws, c.uuid, code)) continue;
        if (tryOne(c.uuid, true)) {
          if (tier === 2) {
            const { hadMatch, summary } = summarizeMatchingFailuresForRepair(
              ws,
              day,
              code,
              breakCandidates,
              true,
            );
            recordV5RepairPreferenceDilution(
              ws,
              {
                date: day,
                gapShift: code,
                chosenName: c.employee.name,
                chosenPreference: ctx.preferredShiftByEmployee.get(c.uuid) ?? null,
                hadMatchingPreferredCandidate: hadMatch,
                whyNotUsed: `restricted-break — ${summary}`,
                stage: "repair_restricted_break",
              },
              warnings,
            );
          }
          return true;
        }
      }
    }

    return ws.hasPaoCoverage(day, code);
  }

  const candidates = sortPaoForCoverageCandidates(ws, dayIndex, entries, code);

  for (const c of candidates) {
    if (tryOne(c.uuid, false)) return true;
  }

  if (
    tryRepairT6T7GapBlockedByPriorT8(ws, day, code, dayIndex, (w, d, shift, di) => {
      const pool = sortPaoForCoverageCandidates(w, di, entries, shift);
      for (const cand of pool) {
        if (wouldExceedT6T7BlockMax(w, cand.uuid, d, shift)) continue;
        if (w.isDayBlockedForShift(cand.uuid, d)) continue;
        if (w.tryAssignShift(cand.uuid, d, shift)) return true;
      }
      return w.hasPaoCoverage(d, shift);
    })
  ) {
    return true;
  }

  for (const c of candidates) {
    if (tryOne(c.uuid, true)) return true;
  }

  for (const c of sortCandidatesForRestrictedShiftBreak(ws, ws.paoEmps, code)) {
    if (tryOne(c.uuid, true)) return true;
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
  const candidates = (
    ws.v5RepairPreferenceStrict
      ? sortPaoForV5RepairT8Coverage(ws, dayIndex, true)
      : sortPaoForT8CoverageCandidates(ws, dayIndex, true)
  ).filter((c) => !isParallelOnlyPreferredPao(ws, c.uuid));

  const fallback = sortCandidatesForRestrictedShiftBreak(
    ws,
    ws.paoEmps.filter(
      (c) =>
        !isParallelOnlyPreferredPao(ws, c.uuid) &&
        !candidates.some((x) => x.uuid === c.uuid),
    ),
    "T8",
  );
  const tryPool = [...candidates, ...fallback];

  const tryAssignT8 = (c: (typeof tryPool)[number], logDilution: boolean): boolean => {
    if (wouldDuplicateT8Coverage(ws, c.uuid, gapDay)) return false;
    if (isNdDayAfterOwnT8Pair(ws, c.uuid, gapDay)) return false;
    if (ws.isDayBlockedForShift(c.uuid, gapDay)) return false;
    if (!ws.tryAssignShift(c.uuid, gapDay, "T8", true)) return false;

    ws.markEmergencyIsolatedT8(c.uuid, gapDay);
    if (logDilution && ws.v5RepairPreferenceStrict) {
      const ctx = ws.ensureRateioContext();
      recordV5RepairPreferenceDilution(
        ws,
        {
          date: gapDay,
          gapShift: "T8",
          chosenName: c.employee.name,
          chosenPreference: ctx.preferredShiftByEmployee.get(c.uuid) ?? null,
          hadMatchingPreferredCandidate: candidates.some(
            (x) => ctx.preferredShiftByEmployee.get(x.uuid) === "T8",
          ),
          whyNotUsed: "T8 isolado emergencial — perfil preferido quebrado",
          stage: "repair_t8_emergency",
        },
        warnings,
      );
    }
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
  };

  for (const c of tryPool) {
    if (ws.v5RepairPreferenceStrict && shouldDeferV5RepairNonPreferred(ws, c.uuid, "T8")) continue;
    if (tryAssignT8(c, false)) return true;
  }

  for (const c of tryPool) {
    if (tryAssignT8(c, ws.v5RepairPreferenceStrict)) return true;
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

  for (let pass = 0; pass < MAX_COVERAGE_REPAIR_PASSES; pass++) {
    let progress = false;
    const gapsBeforePass = ws.listCoverageGaps().length;
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
        if (tryFillT6T7Gap(ws, gap.date, gap.shiftCode, dayIndex, warnings)) {
          if (gap.shiftCode === "T6") t6Filled++;
          else t7Filled++;
          progress = true;
        }
      }
    }

    ws.syncRateioContext();
    ws.clearCoverageGapsCache();
    if (!progress) break;
    if (ws.listCoverageGaps().length === gapsBeforePass) break;
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

function emptyFinalCoverageAudit(): FinalCoverageRepairAudit {
  return {
    t6Filled: 0,
    t7Filled: 0,
    t8BlocksPlaced: 0,
    t8EmergencyIsolated: 0,
    overflowEvents: 0,
    gapsRemaining: 0,
    warnings: [],
  };
}

function mergeScratchPlannedIntoWorkspace(
  ws: GenerationWorkspace,
  scratch: GenerationWorkspace,
): void {
  for (const c of [...ws.paoEmps, ...ws.apaoEmps]) {
    for (const day of ws.days) {
      if (ws.isLockedByAdmin(c.uuid, day)) continue;
      const key = assignmentKey(c.domainId, day);
      ws.planned.delete(key);
      ws.blocked.delete(key);
      const code = scratch.planned.get(key);
      if (code != null) ws.planned.set(key, code);
      const label = scratch.blocked.get(key);
      if (label != null) ws.blocked.set(key, label);
    }
  }
  ws.allocations.splice(
    0,
    ws.allocations.length,
    ...dedupeAllocations(scratch.allocations.map((a) => ({ ...a }))),
  );
  for (const e of ws.listEmergencyIsolatedT8Days()) {
    ws.clearEmergencyIsolatedT8(e.employeeUuid, e.date);
  }
  for (const e of scratch.listEmergencyIsolatedT8Days()) {
    ws.markEmergencyIsolatedT8(e.employeeUuid, e.date);
  }
}

function buildScratchGridFromWorkspace(ws: GenerationWorkspace): GenerationWorkspace {
  const scratch = new GenerationWorkspace(ws.input);
  scratch.applyHardBlocks();
  for (const a of ws.toAssignments()) {
    const did = scratch.uuidToDomain.get(a.employeeUuid);
    if (did != null) scratch.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  scratch.allocations.splice(
    0,
    scratch.allocations.length,
    ...dedupeAllocations(ws.allocations.map((a) => ({ ...a }))),
  );
  for (const e of ws.listEmergencyIsolatedT8Days()) {
    scratch.markEmergencyIsolatedT8(e.employeeUuid, e.date);
  }
  scratch.initRateioContext();
  scratch.syncRateioContext();
  scratch.v5RepairPreferenceStrict = ws.v5RepairPreferenceStrict;
  scratch.v56MinimumLockEnabled = ws.v56MinimumLockEnabled;
  return scratch;
}

/**
 * Reparo de cobertura imediatamente antes de persistir.
 * Usa workspace limpo quando o grid mutado pelo enforce final bloqueia elegibilidade.
 */
export function repairCoverageGapsBeforeSave(ws: GenerationWorkspace): PersistCoverageRepairResult {
  ws.clearCoverageGapsCache();
  const scratch = buildScratchGridFromWorkspace(ws);
  scratch.clearCoverageGapsCache();
  const scratchGapsBefore = scratch.listCoverageGaps().length;
  if (scratchGapsBefore === 0) {
    ws.clearCoverageGapsCache();
    return emptyFinalCoverageAudit();
  }

  const ctx = scratch.rateioContext!;
  let audit = emptyFinalCoverageAudit();

  for (let pass = 0; pass < MAX_BEFORE_SAVE_PASSES; pass++) {
    const gapsBeforePass = scratch.listCoverageGaps().length;
    const passAudit = repairAllCoverageGapsFinal(scratch, ctx);
    audit = {
      t6Filled: audit.t6Filled + passAudit.t6Filled,
      t7Filled: audit.t7Filled + passAudit.t7Filled,
      t8BlocksPlaced: audit.t8BlocksPlaced + passAudit.t8BlocksPlaced,
      t8EmergencyIsolated: audit.t8EmergencyIsolated + passAudit.t8EmergencyIsolated,
      overflowEvents: passAudit.overflowEvents,
      gapsRemaining: passAudit.gapsRemaining,
      warnings: [...audit.warnings, ...passAudit.warnings],
    };
    const filled =
      passAudit.t6Filled + passAudit.t7Filled + passAudit.t8EmergencyIsolated + passAudit.t8BlocksPlaced;
    if (filled > 0) {
      finalizeT8NdBlocks(scratch);
      scratch.syncRateioContext();
    }
    scratch.clearCoverageGapsCache();
    const gapsLeft = scratch.listCoverageGaps().length;
    if (gapsLeft === 0) break;
    if (filled === 0 && gapsLeft >= gapsBeforePass) break;
  }

  scratch.clearCoverageGapsCache();
  let gapsAfterScratch = scratch.listCoverageGaps().length;
  if (gapsAfterScratch > 0 && audit.t8EmergencyIsolated + audit.t8BlocksPlaced + audit.t6Filled + audit.t7Filled > 0) {
    finalizeT8NdBlocks(scratch);
    scratch.syncRateioContext();
    scratch.clearCoverageGapsCache();
    gapsAfterScratch = scratch.listCoverageGaps().length;
  }
  if (gapsAfterScratch >= scratchGapsBefore) {
    ws.clearCoverageGapsCache();
    return { ...audit, gapsRemaining: ws.listCoverageGaps().length };
  }
  if (gapsAfterScratch < scratchGapsBefore) {
    if (gapsAfterScratch === 0) {
      ws.clearCoverageGapsCache();
      return {
        ...audit,
        gapsRemaining: 0,
        persistAssignments: scratch.toAssignments(),
        persistAllocations: dedupeAllocations(scratch.allocations.map((a) => ({ ...a }))),
      };
    }
    const mergeCheck = validateMergePreservesMinimumLock(ws, scratch);
    if (!mergeCheck.ok) {
      ws.clearCoverageGapsCache();
      return {
        ...audit,
        gapsRemaining: ws.listCoverageGaps().length,
        warnings: [
          ...audit.warnings,
          {
            severity: "MÉDIA",
            level: "WARNING",
            type: "V56_MERGE_BLOCKED",
            date: "",
            employee: mergeCheck.name,
            detail: `Merge before-save bloqueado: ${mergeCheck.before}→${mergeCheck.after} (min=${mergeCheck.min}).`,
          },
        ],
      };
    }
    mergeScratchPlannedIntoWorkspace(ws, scratch);
    ws.syncRateioContext();
  }

  ws.clearCoverageGapsCache();
  return {
    ...audit,
    gapsRemaining: ws.listCoverageGaps().length,
  };
}
