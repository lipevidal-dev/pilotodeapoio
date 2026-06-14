import {
  canAssignShiftWithRateio,
  toShiftCode,
  type ShiftCode,
} from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  syncRateioCountsFromWorkspace,
  type ScheduleRateioContext,
} from "./schedule-rateio-context.js";
import {
  captureOptimizationSnapshot,
  restoreOptimizationSnapshot,
} from "./workspace-optimization-transaction.js";
import { assignmentKey } from "./types.js";
import {
  V4TransferAuditCollector,
  combineV4TransferAudits,
  type TransferPhase,
  type TransferRejectionCode,
  type V4CombinedTransferAudit,
  type V4TransferAuditContext,
  type V4TransferPhaseAudit,
} from "./v4-transfer-audit.js";

const TRANSFERABLE_SHIFTS: ShiftCode[] = ["T6", "T7", "T8"];

export interface EnforceTurnTargetsReport {
  transfers: number;
  belowMinBefore: number;
  belowMinAfter: number;
  belowTargetBefore: number;
  belowTargetAfter: number;
  stoppedReason: "all_at_min" | "all_at_target" | "no_valid_transfer";
}

export interface EnforceTurnTargetsOptions {
  phase?: TransferPhase;
  audit?: V4TransferAuditCollector;
}

interface RankedEmployee {
  uuid: string;
  value: number;
}

interface TransferAuditContext {
  collector: V4TransferAuditCollector;
  phase: TransferPhase;
  pass: number;
  donorName: string;
  receiverName: string;
}

function employeeName(ws: GenerationWorkspace, uuid: string): string {
  return ws.input.employees.find((e) => e.uuid === uuid)?.employee.name ?? uuid;
}

function syncCtx(ws: GenerationWorkspace): ScheduleRateioContext {
  const ctx = ws.ensureRateioContext();
  syncRateioCountsFromWorkspace(ws, ctx);
  return ctx;
}

function turnCount(ctx: ScheduleRateioContext, uuid: string): number {
  return (
    (ctx.currentT6Counts.get(uuid) ?? 0) +
    (ctx.currentT7Counts.get(uuid) ?? 0) +
    (ctx.currentT8Counts.get(uuid) ?? 0) +
    (ctx.currentT9Counts.get(uuid) ?? 0)
  );
}

function countBelowMin(ctx: ScheduleRateioContext, ws: GenerationWorkspace): number {
  let n = 0;
  for (const c of ws.paoEmps) {
    const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
    if (turnCount(ctx, c.uuid) < min) n++;
  }
  return n;
}

function countBelowTarget(ctx: ScheduleRateioContext, ws: GenerationWorkspace): number {
  let n = 0;
  for (const c of ws.paoEmps) {
    const target = ctx.targetTurnCounts.get(c.uuid) ?? 0;
    if (turnCount(ctx, c.uuid) < target) n++;
  }
  return n;
}

function listBelowMinimum(ctx: ScheduleRateioContext, ws: GenerationWorkspace): RankedEmployee[] {
  return ws.paoEmps
    .map((c) => {
      const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
      const cur = turnCount(ctx, c.uuid);
      return { uuid: c.uuid, value: Math.max(0, min - cur) };
    })
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || a.uuid.localeCompare(b.uuid));
}

function listBelowTarget(ctx: ScheduleRateioContext, ws: GenerationWorkspace): RankedEmployee[] {
  return ws.paoEmps
    .map((c) => {
      const target = ctx.targetTurnCounts.get(c.uuid) ?? 0;
      const cur = turnCount(ctx, c.uuid);
      return { uuid: c.uuid, value: Math.max(0, target - cur) };
    })
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || a.uuid.localeCompare(b.uuid));
}

function listAboveTarget(ctx: ScheduleRateioContext, ws: GenerationWorkspace): RankedEmployee[] {
  return ws.paoEmps
    .map((c) => {
      const target = ctx.targetTurnCounts.get(c.uuid) ?? 0;
      const cur = turnCount(ctx, c.uuid);
      return { uuid: c.uuid, value: Math.max(0, cur - target) };
    })
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || a.uuid.localeCompare(b.uuid));
}

function donorShiftOnDay(
  ws: GenerationWorkspace,
  donorUuid: string,
  day: string,
): ShiftCode | null {
  const did = ws.uuidToDomain.get(donorUuid);
  if (!did) return null;
  const code = ws.planned.get(assignmentKey(did, day));
  const shift = code ? toShiftCode(code) : null;
  if (!shift || !TRANSFERABLE_SHIFTS.includes(shift)) return null;
  if (shift === "T8" && ws.isT8BlockProtected(donorUuid, day)) return null;
  if (ws.isLockedByAdmin(donorUuid, day)) return null;
  return shift;
}

function listDonorAssignments(
  ws: GenerationWorkspace,
  donorUuid: string,
): Array<{ day: string; shift: ShiftCode }> {
  const out: Array<{ day: string; shift: ShiftCode }> = [];
  for (const day of ws.days) {
    const shift = donorShiftOnDay(ws, donorUuid, day);
    if (shift) out.push({ day, shift });
  }
  return out;
}

function canDonorGive(ctx: ScheduleRateioContext, donorUuid: string): boolean {
  const cur = turnCount(ctx, donorUuid);
  const min = ctx.minTurnCounts.get(donorUuid) ?? 0;
  const target = ctx.targetTurnCounts.get(donorUuid) ?? 0;
  return cur > target && cur - 1 >= min;
}

function donorCannotGiveReason(ctx: ScheduleRateioContext, donorUuid: string): string {
  const cur = turnCount(ctx, donorUuid);
  const min = ctx.minTurnCounts.get(donorUuid) ?? 0;
  const target = ctx.targetTurnCounts.get(donorUuid) ?? 0;
  if (cur <= target) return `atual=${cur} target=${target.toFixed(1)}`;
  if (cur - 1 < min) return `atual=${cur} min=${min} (perderia 1)`;
  return "desconhecido";
}

function receiverRateioCheck(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  receiverUuid: string,
  day: string,
  shift: ShiftCode,
): { allowed: boolean; reasons: string[] } {
  const dayIndex = ws.days.indexOf(day);
  if (dayIndex < 0) return { allowed: false, reasons: ["DIA_INVALIDO"] };

  return canAssignShiftWithRateio({
    monthDays: ws.days.length,
    day: dayIndex + 1,
    shift,
    employeeId: receiverUuid,
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
  });
}

function diagnoseAssignFailure(
  ws: GenerationWorkspace,
  receiverUuid: string,
  day: string,
  shift: string,
): string {
  if (ws.isDayBlockedForShift(receiverUuid, day)) return "dia bloqueado para turno";
  if (ws.isLockedByAdmin(receiverUuid, day)) return "pré-alocação admin";
  const allowed = ws.allowedShiftsForEmployee(receiverUuid);
  if (!allowed.includes(shift)) return `turno ${shift} restrito`;
  return "tryAssignShift recusou (canWork/12h/folgas)";
}

function transferStateValid(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  donorUuid: string,
): boolean {
  if (turnCount(ctx, donorUuid) < (ctx.minTurnCounts.get(donorUuid) ?? 0)) return false;
  if (ws.listCoverageGaps().length > 0) return false;
  ws.ensureNdForT8Pairs();
  return true;
}

function recordRejection(
  audit: TransferAuditContext | undefined,
  base: {
    donorUuid: string;
    receiverUuid: string;
    day: string;
    shift: ShiftCode;
  },
  reason: TransferRejectionCode,
  detail?: string,
): void {
  if (!audit) return;
  audit.collector.recordAttempt({
    phase: audit.phase,
    pass: audit.pass,
    donorId: base.donorUuid,
    donorName: audit.donorName,
    receiverId: base.receiverUuid,
    receiverName: audit.receiverName,
    day: base.day,
    shift: base.shift,
    outcome: "rejected",
    reason,
    detail,
  });
}

function trySameDayTransfer(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  donorUuid: string,
  receiverUuid: string,
  day: string,
  shift: ShiftCode,
  audit?: TransferAuditContext,
): boolean {
  const base = { donorUuid, receiverUuid, day, shift };

  if (donorUuid === receiverUuid) {
    recordRejection(audit, base, "SAME_EMPLOYEE");
    return false;
  }
  if (!canDonorGive(ctx, donorUuid)) {
    recordRejection(audit, base, "DONOR_CANNOT_GIVE", donorCannotGiveReason(ctx, donorUuid));
    return false;
  }

  const did = ws.uuidToDomain.get(donorUuid);
  const rawCode = did ? ws.planned.get(assignmentKey(did, day)) : undefined;
  if (!rawCode) {
    recordRejection(audit, base, "DONOR_NO_SHIFT");
    return false;
  }
  const parsed = toShiftCode(rawCode);
  if (!parsed || parsed !== shift) {
    recordRejection(audit, base, "DONOR_NO_SHIFT", `esperado=${shift} atual=${rawCode ?? "vazio"}`);
    return false;
  }
  if (shift === "T8" && ws.isT8BlockProtected(donorUuid, day)) {
    recordRejection(audit, base, "DONOR_T8_PROTECTED");
    return false;
  }
  if (ws.isLockedByAdmin(donorUuid, day)) {
    recordRejection(audit, base, "DONOR_ADMIN_LOCKED");
    return false;
  }
  if (!ws.isPaoDayEmpty(receiverUuid, day)) {
    recordRejection(audit, base, "RECEIVER_DAY_OCCUPIED");
    return false;
  }
  if (ws.isDayBlockedForShift(receiverUuid, day)) {
    recordRejection(audit, base, "RECEIVER_BLOCKED", "isDayBlockedForShift");
    return false;
  }

  const rateio = receiverRateioCheck(ws, ctx, receiverUuid, day, shift);
  if (!rateio.allowed) {
    recordRejection(
      audit,
      base,
      "RATEIO_MAX",
      rateio.reasons.join(", ") || "RATEIO_TURNOS_ACIMA_MAX",
    );
    return false;
  }

  const receiverBefore = turnCount(ctx, receiverUuid);
  const baseline = captureOptimizationSnapshot(ws);

  const bypassT8 = shift === "T8";
  if (!ws.unassignShift(donorUuid, day, { bypassT8Protection: bypassT8 })) {
    restoreOptimizationSnapshot(ws, baseline);
    recordRejection(audit, base, "UNASSIGN_FAILED");
    return false;
  }

  const receiverBelowMin =
    turnCount(ctx, receiverUuid) < (ctx.minTurnCounts.get(receiverUuid) ?? 0);
  if (!ws.tryAssignShift(receiverUuid, day, shift, receiverBelowMin)) {
    restoreOptimizationSnapshot(ws, baseline);
    recordRejection(
      audit,
      base,
      "ASSIGN_FAILED",
      diagnoseAssignFailure(ws, receiverUuid, day, shift),
    );
    return false;
  }

  syncRateioCountsFromWorkspace(ws, ctx);

  if (turnCount(ctx, receiverUuid) <= receiverBefore) {
    restoreOptimizationSnapshot(ws, baseline);
    syncRateioCountsFromWorkspace(ws, ctx);
    recordRejection(audit, base, "RECEIVER_NO_GAIN", `antes=${receiverBefore}`);
    return false;
  }

  if (turnCount(ctx, donorUuid) < (ctx.minTurnCounts.get(donorUuid) ?? 0)) {
    restoreOptimizationSnapshot(ws, baseline);
    syncRateioCountsFromWorkspace(ws, ctx);
    recordRejection(audit, base, "DONOR_BELOW_MIN_AFTER");
    return false;
  }

  if (!transferStateValid(ws, ctx, donorUuid)) {
    restoreOptimizationSnapshot(ws, baseline);
    syncRateioCountsFromWorkspace(ws, ctx);
    const gaps = ws.listCoverageGaps().length;
    recordRejection(audit, base, "COVERAGE_GAPS_AFTER", `gaps=${gaps}`);
    return false;
  }

  if (audit) {
    audit.collector.recordAttempt({
      phase: audit.phase,
      pass: audit.pass,
      donorId: donorUuid,
      donorName: audit.donorName,
      receiverId: receiverUuid,
      receiverName: audit.receiverName,
      day,
      shift,
      outcome: "accepted",
      reason: "ACCEPTED",
    });
  }

  return true;
}

function runTransferPasses(
  ws: GenerationWorkspace,
  receivers: () => RankedEmployee[],
  stopWhenEmpty: () => boolean,
  options?: EnforceTurnTargetsOptions,
): number {
  const ctx = syncCtx(ws);
  const phase = options?.phase ?? "min";
  const collector = options?.audit;
  let transfers = 0;
  const maxPasses = 500;

  for (let pass = 0; pass < maxPasses; pass++) {
    if (stopWhenEmpty()) break;

    const receiverList = receivers();
    const donorList = listAboveTarget(ctx, ws);

    if (receiverList.length === 0) {
      collector?.recordPassNoReceivers();
      break;
    }
    if (donorList.length === 0) {
      collector?.recordPassNoDonors();
      break;
    }

    let moved = false;

    for (const receiver of receiverList) {
      for (const donor of donorList) {
        if (!canDonorGive(ctx, donor.uuid)) continue;

        const auditCtx: TransferAuditContext | undefined = collector
          ? {
              collector,
              phase,
              pass,
              donorName: employeeName(ws, donor.uuid),
              receiverName: employeeName(ws, receiver.uuid),
            }
          : undefined;

        for (const { day, shift } of listDonorAssignments(ws, donor.uuid)) {
          if (!trySameDayTransfer(ws, ctx, donor.uuid, receiver.uuid, day, shift, auditCtx)) {
            continue;
          }
          transfers++;
          moved = true;
          syncCtx(ws);
          break;
        }
        if (moved) break;
      }
      if (moved) break;
    }

    if (!moved) {
      collector?.recordPassBothFoundAllRejected();
      break;
    }
  }

  return transfers;
}

/** Rebalanceia turnos de PAOs acima do target para PAOs abaixo do mínimo proporcional. */
export function enforceMinimumTurnTargets(
  ws: GenerationWorkspace,
  options?: EnforceTurnTargetsOptions,
): EnforceTurnTargetsReport {
  const ctx = syncCtx(ws);
  const belowMinBefore = countBelowMin(ctx, ws);
  const belowTargetBefore = countBelowTarget(ctx, ws);

  const transfers = runTransferPasses(
    ws,
    () => listBelowMinimum(syncCtx(ws), ws),
    () => countBelowMin(syncCtx(ws), ws) === 0,
    { ...options, phase: "min" },
  );

  const finalCtx = syncCtx(ws);
  const belowMinAfter = countBelowMin(finalCtx, ws);
  const belowTargetAfter = countBelowTarget(finalCtx, ws);

  let stoppedReason: EnforceTurnTargetsReport["stoppedReason"] = "all_at_min";
  if (belowMinAfter > 0) {
    stoppedReason = "no_valid_transfer";
  }

  return {
    transfers,
    belowMinBefore,
    belowMinAfter,
    belowTargetBefore,
    belowTargetAfter,
    stoppedReason,
  };
}

/** Segunda passagem — eleva PAOs abaixo do target usando doadores acima do target. */
export function enforceTargetTurnTargets(
  ws: GenerationWorkspace,
  options?: EnforceTurnTargetsOptions,
): EnforceTurnTargetsReport {
  const ctx = syncCtx(ws);
  const belowMinBefore = countBelowMin(ctx, ws);
  const belowTargetBefore = countBelowTarget(ctx, ws);

  const transfers = runTransferPasses(
    ws,
    () => listBelowTarget(syncCtx(ws), ws),
    () => countBelowTarget(syncCtx(ws), ws) === 0,
    { ...options, phase: "target" },
  );

  const finalCtx = syncCtx(ws);
  const belowMinAfter = countBelowMin(finalCtx, ws);
  const belowTargetAfter = countBelowTarget(finalCtx, ws);

  let stoppedReason: EnforceTurnTargetsReport["stoppedReason"] = "all_at_target";
  if (belowTargetAfter > 0) {
    stoppedReason = "no_valid_transfer";
  }

  return {
    transfers,
    belowMinBefore,
    belowMinAfter,
    belowTargetBefore,
    belowTargetAfter,
    stoppedReason,
  };
}

/** Meta mínima + meta target antes de otimizações estruturais. */
export function enforceProportionalTurnTargets(
  ws: GenerationWorkspace,
  options?: { audit?: V4TransferAuditCollector },
): {
  minimum: EnforceTurnTargetsReport;
  target: EnforceTurnTargetsReport;
} {
  const minimum = enforceMinimumTurnTargets(ws, { audit: options?.audit, phase: "min" });
  const target = enforceTargetTurnTargets(ws, { audit: options?.audit, phase: "target" });
  return { minimum, target };
}

function buildAuditContext(ws: GenerationWorkspace, ctx: ScheduleRateioContext) {
  const belowMin: V4TransferAuditContext["belowMin"] = [];
  const aboveTarget: V4TransferAuditContext["aboveTarget"] = [];

  for (const c of ws.paoEmps) {
    const cur = ctx.currentTurnCounts.get(c.uuid) ?? 0;
    const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
    const target = ctx.targetTurnCounts.get(c.uuid) ?? 0;
    if (cur < min) {
      belowMin.push({
        name: employeeName(ws, c.uuid),
        current: cur,
        min,
        deficit: min - cur,
      });
    }
    if (cur > target) {
      aboveTarget.push({
        name: employeeName(ws, c.uuid),
        current: cur,
        target,
        excess: cur - target,
      });
    }
  }

  belowMin.sort((a, b) => b.deficit - a.deficit);
  aboveTarget.sort((a, b) => b.excess - a.excess);
  return { belowMin, aboveTarget };
}

/**
 * Executa enforce min+target com auditoria completa e restaura o workspace ao final.
 * Usado pelo debug julho/2026 para identificar causa raiz sem alterar a escala gerada.
 */
export function auditV4Transfers(ws: GenerationWorkspace): V4CombinedTransferAudit {
  const snapshot = captureOptimizationSnapshot(ws);
  const ctxInitial = syncCtx(ws);
  const context = buildAuditContext(ws, ctxInitial);

  const minCollector = new V4TransferAuditCollector();
  const ctxBeforeMin = syncCtx(ws);
  const minBefore = {
    belowMinBefore: countBelowMin(ctxBeforeMin, ws),
    belowMinAfter: 0,
    belowTargetBefore: countBelowTarget(ctxBeforeMin, ws),
    belowTargetAfter: 0,
  };

  enforceMinimumTurnTargets(ws, { audit: minCollector, phase: "min" });
  const ctxAfterMin = syncCtx(ws);
  minBefore.belowMinAfter = countBelowMin(ctxAfterMin, ws);
  minBefore.belowTargetAfter = countBelowTarget(ctxAfterMin, ws);
  const minimumPhase = minCollector.buildPhaseAudit("min", minBefore);

  restoreOptimizationSnapshot(ws, snapshot);
  syncCtx(ws);

  const targetCollector = new V4TransferAuditCollector();
  const ctxBeforeTarget = syncCtx(ws);
  const targetBefore = {
    belowMinBefore: countBelowMin(ctxBeforeTarget, ws),
    belowMinAfter: 0,
    belowTargetBefore: countBelowTarget(ctxBeforeTarget, ws),
    belowTargetAfter: 0,
  };

  enforceTargetTurnTargets(ws, { audit: targetCollector, phase: "target" });
  const ctxAfterTarget = syncCtx(ws);
  targetBefore.belowMinAfter = countBelowMin(ctxAfterTarget, ws);
  targetBefore.belowTargetAfter = countBelowTarget(ctxAfterTarget, ws);
  const targetPhase = targetCollector.buildPhaseAudit("target", targetBefore);

  restoreOptimizationSnapshot(ws, snapshot);
  syncCtx(ws);

  return combineV4TransferAudits(context, minimumPhase, targetPhase);
}

export type { V4CombinedTransferAudit, V4TransferPhaseAudit };
