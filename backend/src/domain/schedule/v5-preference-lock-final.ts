import { PAO_COVERAGE_SHIFTS } from "../rules/constants.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { assignmentKey } from "./types.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import type { PreferenceCheckpoint } from "./preference-repair-impact-audit.js";
import { formatPaoPoolSeniority, getPaoPoolSeniority } from "./pao-pool-seniority.js";

export type V5LockedPreferenceRemovalReason =
  | "DUPLICATE_COVERAGE"
  | "COVERAGE_GAP_REPAIR"
  | "OTHER";

export interface V5LockedPreferenceRemovalLog {
  employeeUuid: string;
  name: string;
  date: string;
  shift: string;
  stage: string;
  reason: V5LockedPreferenceRemovalReason;
  detail: string;
}

export interface UnassignV5LockedPreferenceOpts {
  bypassV5LockedPreference?: boolean;
  v5LockedRemovalReason?: V5LockedPreferenceRemovalReason;
  v5LockedRemovalDetail?: string;
}

function assignmentLockKey(uuid: string, day: string): string {
  return `${uuid}|${day}`;
}

export function clearV5PreferenceLockTracking(ws: GenerationWorkspace): void {
  ws.v5LockedPreferenceEmployees.clear();
  ws.v5LockedPreferenceAssignments.clear();
  ws.v5LockedPreferenceRemovalLog.length = 0;
}

/** PAOs com atendimento >= 100% no checkpoint before_repair_gaps_final. */
export function applyV5PreferenceLockFromCheckpoint(
  ws: GenerationWorkspace,
  checkpoint: PreferenceCheckpoint,
): void {
  clearV5PreferenceLockTracking(ws);
  const ctx = ws.ensureRateioContext();

  for (const row of checkpoint.rows) {
    if (row.attendancePercent == null || row.attendancePercent < 100) continue;
    if (!row.preferredShift) continue;
    ws.v5LockedPreferenceEmployees.add(row.employeeUuid);
  }

  for (const uuid of ws.v5LockedPreferenceEmployees) {
    const preferred = ctx.preferredShiftByEmployee.get(uuid);
    if (!preferred) continue;
    for (const a of ws.toAssignments()) {
      if (a.employeeUuid !== uuid) continue;
      if (!isRateioTurnShiftCode(a.shiftCode)) continue;
      if (a.shiftCode.toUpperCase() !== preferred) continue;
      ws.v5LockedPreferenceAssignments.add(assignmentLockKey(uuid, a.date));
    }
  }
}

export function isV5LockedPreferenceEmployee(ws: GenerationWorkspace, uuid: string): boolean {
  return ws.v5LockedPreferenceEmployees.has(uuid);
}

export function isV5LockedPreferenceAssignment(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  return ws.v5LockedPreferenceAssignments.has(assignmentLockKey(uuid, day));
}

function hasOtherPaoOnCoverageShift(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: string,
): boolean {
  for (const c of ws.paoEmps) {
    if (c.uuid === uuid) continue;
    const did = ws.uuidToDomain.get(c.uuid);
    if (!did) continue;
    if (ws.planned.get(`${did}|${day}`) === code) return true;
  }
  return false;
}

/** Remoção criaria gap na célula T6/T7/T8 se não houver substituto no mesmo turno. */
function soleCoverageHolder(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: string,
): boolean {
  const normalized = code.toUpperCase();
  if (!PAO_COVERAGE_SHIFTS.includes(normalized as (typeof PAO_COVERAGE_SHIFTS)[number])) {
    return false;
  }
  return ws.hasPaoCoverage(day, code) && !hasOtherPaoOnCoverageShift(ws, uuid, day, code);
}

export function canUnassignV5LockedPreference(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shiftCode: string,
  opts?: UnassignV5LockedPreferenceOpts,
): boolean {
  if (!isV5LockedPreferenceAssignment(ws, uuid, day)) return true;

  const ctx = ws.rateioContext;
  const preferred = ctx?.preferredShiftByEmployee.get(uuid);
  if (!preferred || shiftCode.toUpperCase() !== preferred) return true;

  if (opts?.bypassV5LockedPreference && opts.v5LockedRemovalReason) return true;

  if (hasOtherPaoOnCoverageShift(ws, uuid, day, shiftCode)) {
    return true;
  }

  if (
    opts?.bypassV5LockedPreference &&
    opts.v5LockedRemovalReason === "COVERAGE_GAP_REPAIR" &&
    ws.listCoverageGaps().length > 0
  ) {
    return true;
  }

  if (soleCoverageHolder(ws, uuid, day, shiftCode)) {
    return false;
  }

  return false;
}

/** Bloqueia diluição pós-lock: PAO locked não recebe turno não preferido. */
export function canAssignV5LockedPreference(
  ws: GenerationWorkspace,
  uuid: string,
  _day: string,
  code: string,
): boolean {
  if (ws.v5LockedPreferenceEmployees.size === 0) return true;
  if (!ws.v5LockedPreferenceEmployees.has(uuid)) return true;

  const preferred = ws.rateioContext?.preferredShiftByEmployee.get(uuid);
  if (!preferred) return true;
  if (!isRateioTurnShiftCode(code)) return true;
  if (code.toUpperCase() === preferred) return true;

  return false;
}

export function logV5LockedPreferenceRemoval(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shift: string,
  reason: V5LockedPreferenceRemovalReason,
  detail: string,
): void {
  const emp = ws.input.employees.find((e) => e.uuid === uuid);
  ws.v5LockedPreferenceRemovalLog.push({
    employeeUuid: uuid,
    name: emp?.employee.name ?? uuid,
    date: day,
    shift,
    stage: ws.v5PipelineStage || "?",
    reason,
    detail,
  });
  ws.v5LockedPreferenceAssignments.delete(assignmentLockKey(uuid, day));
}

export function formatV5PreferenceLockAudit(ws: GenerationWorkspace): string {
  const lines: string[] = ["===== V5.4 PREFERENCE LOCK FINAL =====", ""];

  if (ws.v5LockedPreferenceEmployees.size === 0) {
    lines.push("(nenhum PAO com 100% de preferência em before_repair_gaps_final)");
    return lines.join("\n");
  }

  const ctx = ws.ensureRateioContext();
  lines.push(
    `PAOs locked (${ws.v5LockedPreferenceEmployees.size}) — slots preferidos protegidos: ${ws.v5LockedPreferenceAssignments.size}`,
  );
  lines.push("");
  lines.push("nome | pool | pref | slots locked");

  const locked = [...ws.v5LockedPreferenceEmployees]
    .map((uuid) => {
      const emp = ws.input.employees.find((e) => e.uuid === uuid);
      const pref = ctx.preferredShiftByEmployee.get(uuid) ?? "?";
      const slots = [...ws.v5LockedPreferenceAssignments].filter((k) => k.startsWith(`${uuid}|`)).length;
      const pool = formatPaoPoolSeniority(getPaoPoolSeniority(ws, uuid));
      return {
        name: emp?.employee.name ?? uuid,
        pool,
        pref,
        slots,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  for (const row of locked) {
    lines.push(`${row.name} | ${row.pool} | ${row.pref} | ${row.slots}`);
  }

  if (ws.v5LockedPreferenceRemovalLog.length > 0) {
    lines.push("");
    lines.push("----- remoções autorizadas (bypass) -----");
    lines.push("employee | date | shift | etapa | motivo | detalhe");
    for (const row of ws.v5LockedPreferenceRemovalLog) {
      lines.push(
        `${row.name} | ${row.date} | ${row.shift} | ${row.stage} | ${row.reason} | ${row.detail}`,
      );
    }
  }

  return lines.join("\n");
}

export function lockedPreferredShiftOnDay(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): ShiftCode | null {
  if (!isV5LockedPreferenceAssignment(ws, uuid, day)) return null;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return null;
  const code = ws.planned.get(assignmentKey(did, day));
  if (!code) return null;
  const preferred = ws.rateioContext?.preferredShiftByEmployee.get(uuid);
  if (!preferred || code.toUpperCase() !== preferred) return null;
  return preferred;
}
