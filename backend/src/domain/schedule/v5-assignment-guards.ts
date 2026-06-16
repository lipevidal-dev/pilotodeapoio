import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  canUnassignV5PreferredPhaseDay,
  type UnassignPreferredPhaseOpts,
} from "./v5-preferred-phase-guard.js";
import {
  canUnassignV5LockedPreference,
  type UnassignV5LockedPreferenceOpts,
} from "./v5-preference-lock-final.js";
import {
  canUnassignMinimumLock,
  formatV56MinimumLockAudit,
  type UnassignMinimumLockOpts,
} from "./v5-minimum-lock.js";
import { formatV5PreferenceLockAudit } from "./v5-preference-lock-final.js";
import { formatV5RepairPreferenceDilutionAudit } from "./v5-repair-preference.js";

export type UnassignAssignmentGuardOpts = UnassignPreferredPhaseOpts &
  UnassignV5LockedPreferenceOpts &
  UnassignMinimumLockOpts;

/** Guardas V5 unificadas — ordem: fase preferida → preference lock → minimum lock. */
export function canUnassignAllAssignmentGuards(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shiftCode: string,
  opts?: UnassignAssignmentGuardOpts,
): boolean {
  if (!canUnassignV5PreferredPhaseDay(ws, uuid, day, opts)) return false;
  if (!canUnassignV5LockedPreference(ws, uuid, day, shiftCode, opts)) return false;
  if (!canUnassignMinimumLock(ws, uuid, day, shiftCode, opts)) return false;
  return true;
}

export function formatV57GuardsAudit(ws: GenerationWorkspace): string {
  const lines = [
    "===== V5.7 GUARDS (preference lock + minimum lock + repair pref) =====",
    "",
    formatV5PreferenceLockAudit(ws),
    "",
    formatV56MinimumLockAudit(ws),
    "",
    formatV5RepairPreferenceDilutionAudit(ws),
  ];
  if (ws.v5LockedPreferenceRemovalLog.length > 0) {
    lines.push("", "--- Remoções de preferência locked ---");
    for (const row of ws.v5LockedPreferenceRemovalLog) {
      lines.push(`${row.name} | ${row.date} | ${row.shift} | ${row.stage} | ${row.reason}`);
    }
  } else {
    lines.push("", "(nenhuma remoção de preferência locked registrada)");
  }
  return lines.join("\n");
}
