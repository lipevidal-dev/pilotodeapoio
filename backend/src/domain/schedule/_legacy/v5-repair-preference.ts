import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationInputEmployee } from "../generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { comparePaoForT8Coverage } from "./t8-coverage-priority.js";
import {
  computeTurnRateio,
  sortPaoForCoverageCandidates,
  type TurnRateioEntry,
} from "./real-schedule-turn-rateio.js";
import { sortPaoForT8CoverageCandidates } from "./t8-coverage-priority.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { comparePreferenceSeniorityTieBreak } from "./preference-scoring.js";
import { evaluateTryAssignShiftDetailed } from "./try-assign-shift-detailed.js";
import { shouldDeferNonPreferredFill } from "./v5-preferred-phase-guard.js";
import type { ValidationIssue } from "../types.js";

/** 0 = pref igual ao gap; 1 = sem pref; 2 = pref diferente. */
export type V5RepairPreferenceTier = 0 | 1 | 2;

export interface V5RepairPreferenceDilutionLog {
  date: string;
  gapShift: string;
  chosenName: string;
  chosenPreference: string | null;
  hadMatchingPreferredCandidate: boolean;
  whyNotUsed: string;
  stage: string;
}

export function repairPreferenceTier(
  ctx: ScheduleRateioContext,
  uuid: string,
  gapShift: ShiftCode,
): V5RepairPreferenceTier {
  const pref = ctx.preferredShiftByEmployee.get(uuid);
  if (!pref) return 1;
  if (pref === gapShift) return 0;
  return 2;
}

export function shouldDeferV5RepairNonPreferred(
  ws: GenerationWorkspace,
  uuid: string,
  gapShift: ShiftCode,
): boolean {
  const ctx = ws.ensureRateioContext();
  const pref = ctx.preferredShiftByEmployee.get(uuid);
  if (!pref || pref === gapShift) return false;
  return shouldDeferNonPreferredFill(ws, uuid, pref);
}

function compareWithinRepairTier(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  a: GenerationInputEmployee,
  b: GenerationInputEmployee,
  gapShift: ShiftCode,
): number {
  return comparePreferenceSeniorityTieBreak(ws, ctx, a, b, gapShift);
}

/** Ordena candidatos: pref=gap → sem pref → pref diferente; desempate por senioridade/cota. */
export function sortPaoForV5RepairCoverage(
  ws: GenerationWorkspace,
  dayIndex: number,
  entries: TurnRateioEntry[],
  gapShift: ShiftCode,
): GenerationInputEmployee[] {
  const ctx = ws.ensureRateioContext();
  const base = sortPaoForCoverageCandidates(ws, dayIndex, entries, gapShift);
  return [...base].sort((a, b) => {
    const tierA = repairPreferenceTier(ctx, a.uuid, gapShift);
    const tierB = repairPreferenceTier(ctx, b.uuid, gapShift);
    if (tierA !== tierB) return tierA - tierB;
    return compareWithinRepairTier(ws, ctx, a, b, gapShift);
  });
}

export function sortPaoForV5RepairT8Coverage(
  ws: GenerationWorkspace,
  dayIndex: number,
  coverageEmergency = false,
): GenerationInputEmployee[] {
  const ctx = ws.ensureRateioContext();
  const base = sortPaoForT8CoverageCandidates(ws, dayIndex, coverageEmergency);
  return [...base].sort((a, b) => {
    const tierA = repairPreferenceTier(ctx, a.uuid, "T8");
    const tierB = repairPreferenceTier(ctx, b.uuid, "T8");
    if (tierA !== tierB) return tierA - tierB;
    return comparePaoForT8Coverage(ws, ctx, a, b);
  });
}

export function summarizeMatchingFailuresForRepair(
  ws: GenerationWorkspace,
  day: string,
  gapShift: ShiftCode,
  candidates: GenerationInputEmployee[],
  coverageEmergency: boolean,
): { hadMatch: boolean; summary: string } {
  const ctx = ws.ensureRateioContext();
  const matching = candidates.filter((c) => repairPreferenceTier(ctx, c.uuid, gapShift) === 0);
  if (matching.length === 0) {
    return { hadMatch: false, summary: "(nenhum PAO com pref igual ao gap)" };
  }

  const parts: string[] = [];
  for (const c of matching.slice(0, 5)) {
    const detail = evaluateTryAssignShiftDetailed(ws, c.uuid, day, gapShift, coverageEmergency);
    if (detail.ok) {
      parts.push(`${c.employee.name}: elegível mas não selecionado`);
    } else {
      parts.push(`${c.employee.name}: ${detail.reason ?? "UNKNOWN"}${detail.details ? ` (${detail.details})` : ""}`);
    }
  }
  if (matching.length > 5) parts.push(`+${matching.length - 5} outro(s)`);
  return { hadMatch: true, summary: parts.join("; ") };
}

export function recordV5RepairPreferenceDilution(
  ws: GenerationWorkspace,
  entry: Omit<V5RepairPreferenceDilutionLog, "stage"> & { stage?: string },
  warnings: ValidationIssue[],
): void {
  const row: V5RepairPreferenceDilutionLog = {
    ...entry,
    stage: entry.stage ?? (ws.v5PipelineStage || "repair_coverage"),
  };
  ws.v5RepairPreferenceDilutionLog.push(row);
  warnings.push({
    severity: "MÉDIA",
    level: "WARNING",
    type: "V5_REPAIR_PREFERENCE_DILUTION",
    date: row.date,
    employee: row.chosenName,
    detail:
      `Gap ${row.gapShift} em ${row.date}: ${row.chosenName} (pref ${row.chosenPreference ?? "—"}) — ` +
      `match=${row.hadMatchingPreferredCandidate ? "sim" : "não"}; ${row.whyNotUsed}`,
  });
}

export interface V5RepairAssignAttempt {
  placed: boolean;
  dilution: boolean;
}

/** Tenta alocar respeitando tiers de preferência V5. */
export function tryV5RepairAssignOnGap(
  ws: GenerationWorkspace,
  day: string,
  gapShift: ShiftCode,
  dayIndex: number,
  coverageEmergency: boolean,
  warnings: ValidationIssue[],
  tryAssign: (uuid: string) => boolean,
): V5RepairAssignAttempt {
  const ctx = ws.ensureRateioContext();
  const entries = computeTurnRateio(ws).entries;
  const candidates = sortPaoForV5RepairCoverage(ws, dayIndex, entries, gapShift);

  const tiers: V5RepairPreferenceTier[] = coverageEmergency ? [0, 1, 2] : [0, 1];

  for (const tier of tiers) {
    for (const c of candidates) {
      if (repairPreferenceTier(ctx, c.uuid, gapShift) !== tier) continue;
      if (shouldDeferV5RepairNonPreferred(ws, c.uuid, gapShift)) continue;
      if (tryAssign(c.uuid)) return { placed: true, dilution: false };
    }
  }

  if (!coverageEmergency) {
    for (const c of candidates) {
      if (repairPreferenceTier(ctx, c.uuid, gapShift) !== 2) continue;
      if (shouldDeferV5RepairNonPreferred(ws, c.uuid, gapShift)) continue;
      if (tryAssign(c.uuid)) {
        const { hadMatch, summary } = summarizeMatchingFailuresForRepair(
          ws,
          day,
          gapShift,
          candidates,
          false,
        );
        recordV5RepairPreferenceDilution(
          ws,
          {
            date: day,
            gapShift,
            chosenName: c.employee.name,
            chosenPreference: ctx.preferredShiftByEmployee.get(c.uuid) ?? null,
            hadMatchingPreferredCandidate: hadMatch,
            whyNotUsed: summary,
          },
          warnings,
        );
        return { placed: true, dilution: true };
      }
    }
  }

  if (coverageEmergency) {
    for (const c of candidates) {
      if (repairPreferenceTier(ctx, c.uuid, gapShift) !== 2) continue;
      if (tryAssign(c.uuid)) {
        const pref = ctx.preferredShiftByEmployee.get(c.uuid) ?? null;
        const profile100 = pref != null && shouldDeferNonPreferredFill(ws, c.uuid, pref);
        if (profile100 || pref !== gapShift) {
          const { hadMatch, summary } = summarizeMatchingFailuresForRepair(
            ws,
            day,
            gapShift,
            candidates,
            true,
          );
          recordV5RepairPreferenceDilution(
            ws,
            {
              date: day,
              gapShift,
              chosenName: c.employee.name,
              chosenPreference: pref,
              hadMatchingPreferredCandidate: hadMatch,
              whyNotUsed: `emergência cobertura — ${summary}`,
              stage: "repair_coverage_emergency",
            },
            warnings,
          );
        }
        return { placed: true, dilution: true };
      }
    }

    for (const c of candidates) {
      if (!shouldDeferV5RepairNonPreferred(ws, c.uuid, gapShift)) continue;
      if (tryAssign(c.uuid)) {
        const pref = ctx.preferredShiftByEmployee.get(c.uuid)!;
        const { hadMatch, summary } = summarizeMatchingFailuresForRepair(
          ws,
          day,
          gapShift,
          candidates,
          true,
        );
        recordV5RepairPreferenceDilution(
          ws,
          {
            date: day,
            gapShift,
            chosenName: c.employee.name,
            chosenPreference: pref,
            hadMatchingPreferredCandidate: hadMatch,
            whyNotUsed: `perfil 100% ${pref} quebrado (emergência) — ${summary}`,
            stage: "repair_coverage_emergency_profile",
          },
          warnings,
        );
        return { placed: true, dilution: true };
      }
    }
  }

  return { placed: false, dilution: false };
}

export function formatV5RepairPreferenceDilutionAudit(ws: GenerationWorkspace): string {
  const lines: string[] = [
    "===== REPAIR DILUIÇÃO DE PREFERÊNCIA =====",
    "",
  ];

  if (ws.v5RepairPreferenceDilutionLog.length === 0) {
    lines.push("(nenhuma diluição de preferência registrada no repair)");
    return lines.join("\n");
  }

  lines.push(
    "data | turno gap | funcionário | preferência | havia pref igual? | por que não usado?",
  );
  for (const row of ws.v5RepairPreferenceDilutionLog) {
    lines.push(
      `${row.date} | ${row.gapShift} | ${row.chosenName} | ${row.chosenPreference ?? "—"} | ` +
        `${row.hadMatchingPreferredCandidate ? "sim" : "não"} | ${row.whyNotUsed}`,
    );
  }
  return lines.join("\n");
}

export function clearV5RepairPreferenceAudit(ws: GenerationWorkspace): void {
  ws.v5RepairPreferenceDilutionLog.length = 0;
}
