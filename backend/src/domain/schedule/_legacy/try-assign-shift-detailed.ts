import { canWork } from "../../rules/eligibility.js";
import { has12hRest } from "../../rules/time.js";
import { FANI_LABEL } from "../../rules/birthday.js";
import { IDEAL_PAO_REST_COUNT, VACATION_TYPES } from "../../rules/constants.js";
import { isWeekend } from "../../rules/dates.js";
import {
  canAssignShiftWithRateio,
  toShiftCode,
} from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { normalizeOperationalLabel } from "../operational-labels.js";
import { assignmentKey } from "../types.js";

export type TryAssignShiftRejectReason =
  | "CAN_WORK_FALSE"
  | "MIN_REST"
  | "VACATION"
  | "FP"
  | "FANI"
  | "PREALLOCATION_FIXED"
  | "DAY_OCCUPIED"
  | "RATEIO_MAX"
  | "T6T7_BLOCK_MAX"
  | "WEEKEND_RULE"
  | "SOCIAL_DAY_OFF"
  | "GROUPED_DAY_OFF"
  | "UNKNOWN";

export interface TryAssignShiftDetailedResult {
  ok: boolean;
  reason?: TryAssignShiftRejectReason;
  details?: string;
}

function fail(
  reason: TryAssignShiftRejectReason,
  details?: string,
): TryAssignShiftDetailedResult {
  return { ok: false, reason, details };
}

function blockLabelOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return undefined;
  const key = assignmentKey(did, day);
  return ws.blocked.get(key) ?? ws.historyBlocked.get(key);
}

function mapOperationalLabel(label: string): TryAssignShiftDetailedResult {
  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (VACATION_TYPES.has(upper) || upper === "FÉRIAS" || upper.includes("FÉRIAS")) {
    return fail("VACATION", label);
  }
  if (upper.includes("FOLGA PEDIDA") || upper === "FP") {
    return fail("FP", label);
  }
  if (upper.includes("FOLGA ANIVERS") || upper === "FANI" || upper === FANI_LABEL.toUpperCase()) {
    return fail("FANI", label);
  }
  if (upper === "FOLGA SOCIAL" || upper === "FS") {
    return fail("SOCIAL_DAY_OFF", label);
  }
  if (upper === "FOLGA AGRUPADA" || upper === "FA") {
    return fail("GROUPED_DAY_OFF", label);
  }
  if (
    upper === "SIMULADOR" ||
    upper === "VOO" ||
    upper === "CURSO" ||
    upper === "CURSO ONLINE" ||
    upper === "CMA" ||
    upper === "OUTRO" ||
    upper === "ND" ||
    upper === "FOLGA" ||
    upper === "FOLGA ESCOLHIDA"
  ) {
    return fail("PREALLOCATION_FIXED", label);
  }
  return fail("PREALLOCATION_FIXED", label);
}

function classifyDayBlockedForShift(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): TryAssignShiftDetailedResult | null {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return fail("UNKNOWN", "uuid sem domainId");

  const key = assignmentKey(did, day);
  if (ws.planned.has(key)) {
    return fail("DAY_OCCUPIED", ws.planned.get(key) ?? "turno já alocado");
  }

  if (ws.isLockedByAdmin(uuid, day)) {
    const locked = ws.input.lockedAllocations.find(
      (l) => l.employeeUuid === uuid && l.date === day,
    );
    const label = locked?.label ?? blockLabelOnDay(ws, uuid, day);
    return label ? mapOperationalLabel(label) : fail("PREALLOCATION_FIXED", "pré-alocação admin");
  }

  if (!ws.isDayBlockedForShift(uuid, day)) {
    return null;
  }

  const label =
    blockLabelOnDay(ws, uuid, day) ??
    ws.allocations.find((a) => a.employeeUuid === uuid && a.date === day)?.label;
  return label ? mapOperationalLabel(label) : fail("UNKNOWN", "dia bloqueado para turno");
}

function mapCanWorkReason(reason: string): TryAssignShiftDetailedResult {
  if (reason === "já alocado no dia") {
    return fail("DAY_OCCUPIED", reason);
  }
  if (reason.includes("fim de semana")) {
    return fail("WEEKEND_RULE", reason);
  }
  if (reason.includes("descanso de apenas") || reason.includes("sobreposição")) {
    return fail("MIN_REST", reason);
  }
  if (reason.startsWith("bloqueado:")) {
    const label = reason.replace(/^bloqueado:\s*/i, "");
    return mapOperationalLabel(label);
  }
  if (reason.includes("6 dias consecutivos") || reason.includes("precisa folgar")) {
    return fail("CAN_WORK_FALSE", reason);
  }
  if (reason.includes("limite mensal")) {
    return fail("CAN_WORK_FALSE", reason);
  }
  if (reason.includes("limite físico")) {
    return fail("CAN_WORK_FALSE", reason);
  }
  return fail("CAN_WORK_FALSE", reason || "canWork recusou");
}

/**
 * Avalia tryAssignShift sem mutar o workspace — mesma ordem de checagens do método real,
 * incluindo retry de cobertura emergencial quando rateio bloqueia.
 */
export function evaluateTryAssignShiftDetailed(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: string,
  coverageEmergency = false,
): TryAssignShiftDetailedResult {
  if (coverageEmergency && ws.canWorkOpts.parallelShiftCodes?.has(code.toUpperCase())) {
    return fail("UNKNOWN", "overflow emergencial não permitido para turno paralelo");
  }

  const blocked = classifyDayBlockedForShift(ws, uuid, day);
  if (blocked) return blocked;

  const did = ws.uuidToDomain.get(uuid);
  if (!did) return fail("UNKNOWN", "uuid sem domainId");

  const emp = ws.input.employees.find((e) => e.uuid === uuid)?.employee;
  if (!emp) return fail("UNKNOWN", "funcionário não encontrado");

  const shiftCode = toShiftCode(code);

  if (emp.role === "PAO" && shiftCode && ws.rateioContext) {
    const ctx = ws.rateioContext;
    const eligibility = canAssignShiftWithRateio({
      monthDays: ws.days.length,
      day: ws.days.indexOf(day) + 1,
      shift: shiftCode,
      employeeId: uuid,
      currentTurnCounts: ctx.currentTurnCounts,
      maxTurnCounts: ctx.maxTurnCounts,
      minTurnCounts: ctx.minTurnCounts,
      targetTurnCounts: ctx.targetTurnCounts,
      t6Counts: ctx.currentT6Counts,
      t7Counts: ctx.currentT7Counts,
      t8Counts: ctx.currentT8Counts,
      t9Counts: ctx.currentT9Counts,
      preferredShiftByEmployee: ctx.preferredShiftByEmployee,
      strictMaxTurnCount: true,
      allowEmergencyOverflow: coverageEmergency,
    });
    if (!eligibility.allowed) {
      if (!coverageEmergency && !ws.hasPaoBelowMaxForRateio(uuid)) {
        return evaluateTryAssignShiftDetailed(ws, uuid, day, code, true);
      }
      const current = ctx.currentTurnCounts.get(uuid) ?? 0;
      const max = ctx.maxTurnCounts.get(uuid);
      return fail(
        "RATEIO_MAX",
        max != null ? `${current}/${max} turnos (${eligibility.reasons.join(", ")})` : eligibility.reasons.join(", "),
      );
    }
  }

  if (emp.role === "PAO" && !coverageEmergency) {
    const budget = ws.workCount(uuid) + 1 + ws.countNd(uuid) + IDEAL_PAO_REST_COUNT;
    if (budget > ws.days.length) {
      return fail(
        "CAN_WORK_FALSE",
        `budget folgas: work+ND+folgas=${budget} > dias=${ws.days.length}`,
      );
    }
    const maxWork = ws.maxWorkDaysForPao(uuid);
    if (maxWork != null && ws.workCount(uuid) >= maxWork) {
      return fail("CAN_WORK_FALSE", `workCount ${ws.workCount(uuid)}/${maxWork}`);
    }
  }

  const continuity = ws.getContinuityPlanned();
  const continuityBlocked = ws.getContinuityBlocked();
  const work = canWork(emp, day, code, ws.blocked, continuity, {
    ...ws.canWorkOpts,
    continuityBlocked,
    coverageEmergency,
  });
  if (!work.ok) {
    return mapCanWorkReason(work.reason);
  }

  const rest12 = has12hRest(did, day, code, continuity, ws.shiftMap, ws.timedOccupancies);
  if (!rest12.ok) {
    return fail("MIN_REST", rest12.reason);
  }

  const shiftInfo = ws.shiftMap[code];
  if (shiftInfo?.noWeekends && isWeekend(day)) {
    return fail("WEEKEND_RULE", `turno ${code} não permitido em fim de semana`);
  }

  return { ok: true };
}
