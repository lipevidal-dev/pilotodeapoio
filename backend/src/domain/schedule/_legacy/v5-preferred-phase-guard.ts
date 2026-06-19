import { addDays } from "../../rules/dates.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";

export type PreferredPhaseRemovalReason =
  | "VACATION_FP_FANI_LOCKED"
  | "REST_12H"
  | "T8_PAIR_INVALID"
  | "DUPLICATE_COVERAGE"
  | "ND_DAY_CONFLICT"
  | "T8_BLOCK_ROLLBACK"
  | "OTHER_RULE";

export interface PreferredPhaseRemovalLog {
  employeeUuid: string;
  name: string;
  date: string;
  shift: string;
  stage: string;
  reason: PreferredPhaseRemovalReason;
  detail: string;
}

function dayKey(uuid: string, day: string): string {
  return `${uuid}|${day}`;
}

export function clearV5PreferredPhaseTracking(ws: GenerationWorkspace): void {
  ws.v5PreferredPhaseDays.clear();
  ws.v5PreferredPhaseRemovalLog.length = 0;
  ws.v5PipelineStage = "";
}

export function setV5PipelineStage(ws: GenerationWorkspace, stage: string): void {
  ws.v5PipelineStage = stage;
}

export function markV5PreferredPhaseDay(ws: GenerationWorkspace, uuid: string, day: string): void {
  ws.v5PreferredPhaseDays.add(dayKey(uuid, day));
}

export function isV5PreferredPhaseDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  return ws.v5PreferredPhaseDays.has(dayKey(uuid, day));
}

export function markV5PreferredPhaseShift(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: ShiftCode,
): boolean {
  if (!ws.tryAssignShift(uuid, day, code)) return false;
  markV5PreferredPhaseDay(ws, uuid, day);
  return true;
}

export function markV5PreferredPhaseT8Block(
  ws: GenerationWorkspace,
  uuid: string,
  startDay: string,
): boolean {
  if (!ws.tryPlaceT8Block(uuid, startDay)) return false;
  markV5PreferredPhaseDay(ws, uuid, startDay);
  const d1 = addDays(startDay, 1);
  if (ws.days.includes(d1)) markV5PreferredPhaseDay(ws, uuid, d1);
  return true;
}

export interface UnassignPreferredPhaseOpts {
  bypassPreferredPhaseProtection?: boolean;
  preferredRemovalReason?: PreferredPhaseRemovalReason;
  preferredRemovalDetail?: string;
}

export function canUnassignV5PreferredPhaseDay(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  opts?: UnassignPreferredPhaseOpts,
): boolean {
  if (!isV5PreferredPhaseDay(ws, uuid, day)) return true;
  return Boolean(opts?.bypassPreferredPhaseProtection && opts.preferredRemovalReason);
}

export function logV5PreferredPhaseRemoval(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shift: string,
  reason: PreferredPhaseRemovalReason,
  detail: string,
): void {
  const emp = ws.input.employees.find((e) => e.uuid === uuid);
  ws.v5PreferredPhaseRemovalLog.push({
    employeeUuid: uuid,
    name: emp?.employee.name ?? uuid,
    date: day,
    shift,
    stage: ws.v5PipelineStage || "?",
    reason,
    detail,
  });
  ws.v5PreferredPhaseDays.delete(dayKey(uuid, day));
}

export function formatInterPhasePreferredRemovalAudit(ws: GenerationWorkspace): string {
  const lines: string[] = [
    "===== REMOÇÃO DE PREFERÊNCIA ENTRE FASES =====",
    "",
  ];

  if (ws.v5PreferredPhaseRemovalLog.length === 0) {
    lines.push("(nenhuma remoção de turno da fase preferida registrada)");
    return lines.join("\n");
  }

  lines.push("employee | date | shift | etapa | motivo | detalhe");
  for (const row of ws.v5PreferredPhaseRemovalLog) {
    lines.push(
      `${row.name} | ${row.date} | ${row.shift} | ${row.stage} | ${row.reason} | ${row.detail}`,
    );
  }
  return lines.join("\n");
}

/** Perfil 100% preferido — fill complementar não dilui antes do repair. */
export function shouldDeferNonPreferredFill(
  ws: GenerationWorkspace,
  uuid: string,
  preferred: ShiftCode,
): boolean {
  let total = 0;
  let pref = 0;
  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    if (!isRateioTurnShiftCode(a.shiftCode)) continue;
    total++;
    if (a.shiftCode.toUpperCase() === preferred) pref++;
  }
  return total > 0 && pref === total;
}
