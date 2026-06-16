import { addDays } from "../rules/dates.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import { isNdDayAfterOwnT8Pair } from "./schedule-grid-source.js";
import {
  currentTurnCount,
  type ScheduleRateioContext,
} from "./schedule-rateio-context.js";
import type { ValidationIssue } from "./types.js";
import { sortPaoByPoolSeniority } from "./pao-pool-seniority.js";
import {
  markV5PreferredPhaseShift,
  markV5PreferredPhaseT8Block,
  shouldDeferNonPreferredFill,
} from "./v5-preferred-phase-guard.js";
import {
  hasViablePreferredSlotRemaining,
  recordV5FillPreferenceDilution,
  summarizePreferredSlotExhaustion,
} from "./v5-fill-preference.js";

const RATEIO_SHIFTS: ShiftCode[] = ["T6", "T7", "T8", "T9"];

function employeesBySeniority(ws: GenerationWorkspace) {
  return sortPaoByPoolSeniority(ws);
}

function quotaTarget(ctx: ScheduleRateioContext, uuid: string): number {
  return ctx.targetTurnCounts.get(uuid) ?? 0;
}

function belowQuotaTarget(ctx: ScheduleRateioContext, uuid: string): boolean {
  return currentTurnCount(ctx, uuid) < quotaTarget(ctx, uuid);
}

/** PAO pref T6 abaixo da cota ainda com dia viável — reserva cobertura T6. */
function shouldReserveT6ForPreferredPool(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): boolean {
  for (const c of ws.paoEmps) {
    const pref = ctx.preferredShiftByEmployee.get(c.uuid);
    if (pref !== "T6") continue;
    if (!belowQuotaTarget(ctx, c.uuid)) continue;
    if (hasViablePreferredSlotRemaining(ws, c.uuid, "T6")) return true;
  }
  return false;
}

function nonPreferredShiftsForEmployee(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
): ShiftCode[] {
  const preferred = ctx.preferredShiftByEmployee.get(uuid);
  const allowed = new Set(ws.allowedShiftsForEmployee(uuid, RATEIO_SHIFTS));
  const order: ShiftCode[] = [];
  for (const code of RATEIO_SHIFTS) {
    if (!allowed.has(code)) continue;
    if (code === preferred) continue;
    order.push(code);
  }
  if (preferred === "T8") {
    order.sort((a, b) => {
      const rank = (c: ShiftCode) => (c === "T7" ? 0 : c === "T9" ? 1 : c === "T6" ? 2 : 3);
      return rank(a) - rank(b);
    });
  } else {
    order.sort((a, b) => (a === "T8" ? 1 : 0) - (b === "T8" ? 1 : 0));
  }
  return order;
}

function tryMonoShiftOnDay(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: ShiftCode,
  markPreferred = false,
): boolean {
  if (ws.findPaoOnShift(day, code)) return false;
  if (code === "T8" && isNdDayAfterOwnT8Pair(ws, uuid, day)) return false;
  if (ws.isDayBlockedForShift(uuid, day)) return false;
  if (markPreferred) return markV5PreferredPhaseShift(ws, uuid, day, code);
  return ws.tryAssignShift(uuid, day, code);
}

function tryT8MonoForQuota(
  ws: GenerationWorkspace,
  uuid: string,
  markPreferred = false,
): boolean {
  for (const day of ws.days) {
    if (tryMonoShiftOnDay(ws, uuid, day, "T8", markPreferred)) return true;
  }
  return false;
}

function tryT8BlockForQuota(
  ws: GenerationWorkspace,
  uuid: string,
  markPreferred = false,
): boolean {
  for (const day of ws.days) {
    if (ws.findPaoOnShift(day, "T8")) continue;
    if (markPreferred) {
      if (markV5PreferredPhaseT8Block(ws, uuid, day)) return true;
    } else if (ws.tryPlaceT8Block(uuid, day)) {
      return true;
    }
    const prev = addDays(day, -1);
    if (ws.days.includes(prev) && !ws.findPaoOnShift(day, "T8")) {
      if (ws.tryCompleteT8Pair(uuid, day)) return true;
    }
  }
  return false;
}

/** Slot viável do turno preferido (read-only — não muta escala). */
export function hasViablePreferredSlot(
  ws: GenerationWorkspace,
  uuid: string,
  preferred: ShiftCode,
): boolean {
  return hasViablePreferredSlotRemaining(ws, uuid, preferred);
}

/** Tenta alocar exatamente um turno do tipo preferido (bloco T8 ou mono). */
function tryPreferredShiftForEmployee(
  ws: GenerationWorkspace,
  uuid: string,
  preferred: ShiftCode,
  markPreferred = false,
): boolean {
  if (preferred === "T8") {
    if (tryT8BlockForQuota(ws, uuid, markPreferred)) return true;
    return tryT8MonoForQuota(ws, uuid, markPreferred);
  }

  if (isParallelOnlyPreferredPao(ws, uuid) && preferred !== "T9") return false;

  for (const day of ws.days) {
    if (tryMonoShiftOnDay(ws, uuid, day, preferred, markPreferred)) return true;
  }
  return false;
}

function tryNonPreferredShiftForQuota(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
  c: { uuid: string; employee: { name: string } },
  warnings: ValidationIssue[],
): boolean {
  const preferred = ctx.preferredShiftByEmployee.get(uuid) ?? null;
  if (preferred && hasViablePreferredSlotRemaining(ws, uuid, preferred)) return false;
  if (preferred && shouldDeferNonPreferredFill(ws, uuid, preferred)) return false;

  const exhaustionReason = preferred
    ? summarizePreferredSlotExhaustion(ws, uuid, preferred)
    : "sem preferência cadastrada";

  const shifts = nonPreferredShiftsForEmployee(ws, ctx, uuid);
  for (const code of shifts) {
    if (code === "T6" && preferred !== "T6" && shouldReserveT6ForPreferredPool(ws, ctx)) {
      continue;
    }
    if (code === "T8" && preferred !== "T8") continue;
    if (code === "T8") {
      if (tryT8MonoForQuota(ws, uuid)) return true;
      if (tryT8BlockForQuota(ws, uuid)) return true;
      continue;
    }
    if (isParallelOnlyPreferredPao(ws, uuid) && code !== "T9") continue;
    for (const day of ws.days) {
      if (!tryMonoShiftOnDay(ws, uuid, day, code)) continue;
      if (preferred && code !== preferred) {
        recordV5FillPreferenceDilution(
          ws,
          {
            date: day,
            allocatedShift: code,
            employeeName: c.employee.name,
            preferredShift: preferred,
            hadPreferredSlot: false,
            reason: exhaustionReason,
          },
          warnings,
        );
      }
      return true;
    }
  }
  return false;
}

function warnQuotaNotReached(
  ctx: ScheduleRateioContext,
  c: { uuid: string; employee: { name: string } },
  warnings: ValidationIssue[],
): void {
  if (currentTurnCount(ctx, c.uuid) >= (ctx.minTurnCounts.get(c.uuid) ?? 0)) return;
  warnings.push({
    severity: "MÉDIA",
    level: "WARNING",
    type: "V5_QUOTA_NOT_REACHED",
    date: "",
    employee: c.employee.name,
    detail:
      `Cota não atingida: ${currentTurnCount(ctx, c.uuid)}/${quotaTarget(ctx, c.uuid)} turnos ` +
      `(min=${ctx.minTurnCounts.get(c.uuid) ?? 0}).`,
  });
}

function warnFillDeferredStrict(
  c: { uuid: string; employee: { name: string } },
  preferred: ShiftCode,
  ws: GenerationWorkspace,
  uuid: string,
  warnings: ValidationIssue[],
): void {
  const remaining = summarizePreferredSlotExhaustion(ws, uuid, preferred);
  warnings.push({
    severity: "BAIXA",
    level: "WARNING",
    type: "V5_FILL_DEFERRED_STRICT_PREFERRED",
    date: "",
    employee: c.employee.name,
    detail:
      `Fill complementar interrompido — ainda há slot ${preferred} viável no mês (${remaining}). ` +
      "Cota restante fica para repair.",
  });
}

/**
 * Fase 1 — por senioridade crescente, completa cota só com turno preferido.
 * Pool T6: round-robin (1 turno por PAO por rodada) para juniors não ficarem sem T6.
 */
export function v5AllocatePreferredTurnsBySeniority(
  ws: GenerationWorkspace,
  _warnings: ValidationIssue[],
): void {
  ws.initRateioContext();
  const ctx = ws.rateioContext!;

  const t6PrefPool = employeesBySeniority(ws).filter(
    (c) => ctx.preferredShiftByEmployee.get(c.uuid) === "T6",
  );

  let t6RoundProgress = true;
  let t6Safety = 0;
  while (t6RoundProgress && t6Safety++ < ws.days.length * t6PrefPool.length * 2) {
    t6RoundProgress = false;
    for (const c of t6PrefPool) {
      const uuid = c.uuid;
      const allowed = ws.allowedShiftsForEmployee(uuid, RATEIO_SHIFTS);
      if (!allowed.includes("T6")) continue;
      if (!belowQuotaTarget(ctx, uuid)) continue;
      if (tryPreferredShiftForEmployee(ws, uuid, "T6", true)) {
        t6RoundProgress = true;
        ws.syncRateioContext();
      }
    }
  }

  for (const c of employeesBySeniority(ws)) {
    const uuid = c.uuid;
    const preferred = ctx.preferredShiftByEmployee.get(uuid);
    if (!preferred || preferred === "T6") continue;

    const allowed = ws.allowedShiftsForEmployee(uuid, RATEIO_SHIFTS);
    if (!allowed.includes(preferred)) continue;

    const target = quotaTarget(ctx, uuid);
    if (target <= 0) continue;

    let safety = 0;
    while (belowQuotaTarget(ctx, uuid) && safety++ < ws.days.length * 4) {
      if (!tryPreferredShiftForEmployee(ws, uuid, preferred, true)) break;
      ws.syncRateioContext();
    }
  }
}

/**
 * Fase 2 — completa cota restante (V5.2 strict).
 * Enquanto existir slot preferido viável no mês, só tenta preferido — nunca dilui.
 * Turno não preferido só quando nenhum slot preferido restante for viável.
 */
export function v5FillRemainingQuotaWithAnyAllowedShift(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[],
): void {
  ws.initRateioContext();
  const ctx = ws.rateioContext!;

  const t6PrefFirst = employeesBySeniority(ws).filter(
    (c) => ctx.preferredShiftByEmployee.get(c.uuid) === "T6",
  );
  let t6FillRound = true;
  let t6FillSafety = 0;
  while (t6FillRound && t6FillSafety++ < ws.days.length * t6PrefFirst.length * 2) {
    t6FillRound = false;
    for (const c of t6PrefFirst) {
      const uuid = c.uuid;
      if (!belowQuotaTarget(ctx, uuid)) continue;
      if (tryPreferredShiftForEmployee(ws, uuid, "T6", false)) {
        t6FillRound = true;
        ws.syncRateioContext();
      }
    }
  }

  for (const c of employeesBySeniority(ws)) {
    const uuid = c.uuid;
    const target = quotaTarget(ctx, uuid);
    if (target <= 0) continue;

    const allowed = ws.allowedShiftsForEmployee(uuid, RATEIO_SHIFTS);
    const preferred = ctx.preferredShiftByEmployee.get(uuid) ?? null;

    let safety = 0;
    while (belowQuotaTarget(ctx, uuid) && safety++ < ws.days.length * 4) {
      if (preferred && allowed.includes(preferred)) {
        if (tryPreferredShiftForEmployee(ws, uuid, preferred, false)) {
          ws.syncRateioContext();
          continue;
        }

        if (hasViablePreferredSlotRemaining(ws, uuid, preferred)) {
          warnFillDeferredStrict(c, preferred, ws, uuid, warnings);
          break;
        }
      }

      if (!tryNonPreferredShiftForQuota(ws, ctx, uuid, c, warnings)) {
        warnQuotaNotReached(ctx, c, warnings);
        break;
      }
      ws.syncRateioContext();
    }
  }
}

/**
 * Aloca turnos por senioridade (mais antigo primeiro) até a cota target.
 * Fase preferida → fase complementar (cobertura fica para repairCoverageGapsFinal).
 */
export function v5AllocateBySeniorityQuota(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[],
): void {
  v5AllocatePreferredTurnsBySeniority(ws, warnings);
  v5FillRemainingQuotaWithAnyAllowedShift(ws, warnings);
}

/** Conta turnos preferidos vs não preferidos recebidos (auditoria V5). */
export function v5CountPreferredVsRestricted(
  ws: GenerationWorkspace,
  uuid: string,
): { preferred: number; nonPreferred: number; restrictedBroken: number; totalRateio: number } {
  const ctx = ws.rateioContext;
  const preferred = ctx?.preferredShiftByEmployee.get(uuid) ?? null;
  const did = ws.uuidToDomain.get(uuid);
  const restricted =
    did != null ? ws.input.shiftRestrictions?.get(did) : undefined;

  let prefCount = 0;
  let nonPref = 0;
  let restrictedBroken = 0;
  let totalRateio = 0;

  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    if (!isRateioTurnShiftCode(a.shiftCode)) continue;
    totalRateio++;
    if (preferred && a.shiftCode === preferred) prefCount++;
    else nonPref++;
    if (restricted?.has(a.shiftCode.toUpperCase())) restrictedBroken++;
  }

  return { preferred: prefCount, nonPreferred: nonPref, restrictedBroken, totalRateio };
}
