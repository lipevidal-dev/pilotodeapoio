import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import {
  canAssignShiftWithRateio,
  toShiftCode,
  type ShiftCode,
} from "./assignment-eligibility.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GenerationInput } from "./generation-types.js";
import { GenerationWorkspace } from "./generation-workspace.js";
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
import { capturePersistenceFocus } from "./persistence-focus-trace.js";
import { rejectTransferIfWouldDropDonorBelowMin } from "./v5-minimum-lock.js";

const TRANSFERABLE_SHIFTS: ShiftCode[] = ["T6", "T7", "T8"];
const MIN_PHASE_SHIFTS: ShiftCode[] = ["T6", "T7"];
const MAX_TRANSFER_PASSES = 2000;

type DonorTier = "above_target" | "above_min";

export interface RateioMinimumIssue {
  name: string;
  uuid: string;
  current: number;
  min: number;
  deficit: number;
  hasValidTransfer: boolean;
  transferHint?: string;
}

export interface RateioMinimumValidation {
  ok: boolean;
  issues: RateioMinimumIssue[];
}

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

/** Soma déficits proporcionais — usado para detectar loop sem progresso. */
function totalMinDeficit(ctx: ScheduleRateioContext, ws: GenerationWorkspace): number {
  let sum = 0;
  for (const c of ws.paoEmps) {
    const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
    const cur = turnCount(ctx, c.uuid);
    if (cur < min) sum += min - cur;
  }
  return sum;
}

function totalTargetDeficit(ctx: ScheduleRateioContext, ws: GenerationWorkspace): number {
  let sum = 0;
  for (const c of ws.paoEmps) {
    const target = ctx.targetTurnCounts.get(c.uuid) ?? 0;
    const cur = turnCount(ctx, c.uuid);
    if (cur < target) sum += target - cur;
  }
  return sum;
}

function totalDeficitForPhase(
  ctx: ScheduleRateioContext,
  ws: GenerationWorkspace,
  phase: TransferPhase,
): number {
  return phase === "min" ? totalMinDeficit(ctx, ws) : totalTargetDeficit(ctx, ws);
}

function maxPassesForPhase(
  ctx: ScheduleRateioContext,
  ws: GenerationWorkspace,
  phase: TransferPhase,
): number {
  const deficit = totalDeficitForPhase(ctx, ws, phase);
  const ceiling = Math.ceil(deficit) + ws.paoEmps.length;
  return Math.min(MAX_TRANSFER_PASSES, Math.max(1, ceiling));
}

function transferEdgeKey(
  donorUuid: string,
  receiverUuid: string,
  day: string,
  shift: ShiftCode,
): string {
  return `${donorUuid}|${receiverUuid}|${day}|${shift}`;
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

/** Doadores acima do min mas não acima do target — fallback da fase min. */
function listDonorsAboveMinNotTarget(
  ctx: ScheduleRateioContext,
  ws: GenerationWorkspace,
): RankedEmployee[] {
  return ws.paoEmps
    .map((c) => {
      const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
      const target = ctx.targetTurnCounts.get(c.uuid) ?? 0;
      const cur = turnCount(ctx, c.uuid);
      return { uuid: c.uuid, value: Math.max(0, cur - min), cur, min, target };
    })
    .filter((e) => {
      if (e.value <= 0 || e.cur - 1 < e.min) return false;
      return e.cur <= e.target;
    })
    .sort((a, b) => b.value - a.value || a.uuid.localeCompare(b.uuid));
}

function canDonorGiveAtTier(
  ctx: ScheduleRateioContext,
  donorUuid: string,
  tier: DonorTier,
): boolean {
  const cur = turnCount(ctx, donorUuid);
  const min = ctx.minTurnCounts.get(donorUuid) ?? 0;
  const target = ctx.targetTurnCounts.get(donorUuid) ?? 0;
  if (cur - 1 < min) return false;
  if (tier === "above_target") return cur > target;
  return cur > min;
}

function canDonorGiveForPhase(
  ctx: ScheduleRateioContext,
  donorUuid: string,
  phase: TransferPhase,
  tier: DonorTier,
): boolean {
  if (phase === "target") return canDonorGiveAtTier(ctx, donorUuid, "above_target");
  return canDonorGiveAtTier(ctx, donorUuid, tier);
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

function shiftSortRank(shift: ShiftCode): number {
  if (shift === "T6" || shift === "T7") return 0;
  return 1;
}

function listDonorAssignments(
  ws: GenerationWorkspace,
  donorUuid: string,
  phase: TransferPhase,
): Array<{ day: string; shift: ShiftCode }> {
  const out: Array<{ day: string; shift: ShiftCode }> = [];
  for (const day of ws.days) {
    const shift = donorShiftOnDay(ws, donorUuid, day);
    if (!shift) continue;
    if (phase === "min" && !MIN_PHASE_SHIFTS.includes(shift)) continue;
    out.push({ day, shift });
  }
  out.sort(
    (a, b) =>
      shiftSortRank(a.shift) - shiftSortRank(b.shift) ||
      a.day.localeCompare(b.day),
  );
  return out;
}

function donorCannotGiveReason(
  ctx: ScheduleRateioContext,
  donorUuid: string,
  tier: DonorTier,
): string {
  const cur = turnCount(ctx, donorUuid);
  const min = ctx.minTurnCounts.get(donorUuid) ?? 0;
  const target = ctx.targetTurnCounts.get(donorUuid) ?? 0;
  if (cur - 1 < min) return `atual=${cur} min=${min} (perderia 1)`;
  if (tier === "above_target" && cur <= target) {
    return `atual=${cur} target=${target.toFixed(1)}`;
  }
  if (tier === "above_min" && cur <= min) return `atual=${cur} min=${min}`;
  return "desconhecido";
}

/** Libera folga gerada (não admin) para permitir transferência same-day. */
function tryPrepareReceiverDayForTransfer(
  ws: GenerationWorkspace,
  receiverUuid: string,
  day: string,
): boolean {
  if (ws.isPaoDayEmpty(receiverUuid, day)) return true;
  const did = ws.uuidToDomain.get(receiverUuid);
  if (!did) return false;
  if (ws.planned.has(assignmentKey(did, day))) return false;
  if (ws.isLockedByAdmin(receiverUuid, day)) return false;

  const blockedLabel = ws.blocked.get(assignmentKey(did, day));
  if (!blockedLabel) return false;
  const upper = blockedLabel.toUpperCase();
  if (upper !== "FOLGA" && upper !== "FOLGA SOCIAL") return false;

  ws.blocked.delete(assignmentKey(did, day));
  const allocIdx = ws.allocations.findIndex(
    (a) => a.employeeUuid === receiverUuid && a.date === day,
  );
  if (allocIdx >= 0) ws.allocations.splice(allocIdx, 1);
  return ws.isPaoDayEmpty(receiverUuid, day);
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

interface TransferAuditContext {
  collector: V4TransferAuditCollector;
  phase: TransferPhase;
  pass: number;
  donorName: string;
  receiverName: string;
  donorTier: DonorTier;
}

function trySameDayTransfer(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  donorUuid: string,
  receiverUuid: string,
  day: string,
  shift: ShiftCode,
  audit?: TransferAuditContext,
  explicitTier?: DonorTier,
): boolean {
  const phase = audit?.phase ?? "min";
  const tier = audit?.donorTier ?? explicitTier ?? "above_target";
  const base = { donorUuid, receiverUuid, day, shift };
  const baseline = captureOptimizationSnapshot(ws);

  const reject = (reason: TransferRejectionCode, detail?: string): false => {
    restoreOptimizationSnapshot(ws, baseline);
    syncRateioCountsFromWorkspace(ws, ctx);
    recordRejection(audit, base, reason, detail);
    return false;
  };

  if (donorUuid === receiverUuid) {
    return reject("SAME_EMPLOYEE");
  }
  if (!canDonorGiveForPhase(ctx, donorUuid, phase, tier)) {
    return reject("DONOR_CANNOT_GIVE", donorCannotGiveReason(ctx, donorUuid, tier));
  }

  const did = ws.uuidToDomain.get(donorUuid);
  const rawCode = did ? ws.planned.get(assignmentKey(did, day)) : undefined;
  if (!rawCode) {
    return reject("DONOR_NO_SHIFT");
  }
  const parsed = toShiftCode(rawCode);
  if (!parsed || parsed !== shift) {
    return reject("DONOR_NO_SHIFT", `esperado=${shift} atual=${rawCode ?? "vazio"}`);
  }
  if (shift === "T8" && ws.isT8BlockProtected(donorUuid, day)) {
    return reject("DONOR_T8_PROTECTED");
  }
  if (ws.isLockedByAdmin(donorUuid, day)) {
    return reject("DONOR_ADMIN_LOCKED");
  }

  tryPrepareReceiverDayForTransfer(ws, receiverUuid, day);
  if (!ws.isPaoDayEmpty(receiverUuid, day)) {
    return reject("RECEIVER_DAY_OCCUPIED");
  }
  if (ws.isDayBlockedForShift(receiverUuid, day)) {
    return reject("RECEIVER_BLOCKED", "isDayBlockedForShift");
  }

  const rateio = receiverRateioCheck(ws, ctx, receiverUuid, day, shift);
  if (!rateio.allowed) {
    return reject("RATEIO_MAX", rateio.reasons.join(", ") || "RATEIO_TURNOS_ACIMA_MAX");
  }

  const receiverBefore = turnCount(ctx, receiverUuid);

  const minLockReject = rejectTransferIfWouldDropDonorBelowMin(ws, donorUuid, day, shift);
  if (minLockReject) {
    return reject(minLockReject as TransferRejectionCode);
  }

  const bypassT8 = shift === "T8";
  if (!ws.unassignShift(donorUuid, day, { bypassT8Protection: bypassT8 })) {
    return reject("UNASSIGN_FAILED");
  }

  const receiverBelowMin =
    turnCount(ctx, receiverUuid) < (ctx.minTurnCounts.get(receiverUuid) ?? 0);
  if (!ws.tryAssignShift(receiverUuid, day, shift, receiverBelowMin)) {
    return reject("ASSIGN_FAILED", diagnoseAssignFailure(ws, receiverUuid, day, shift));
  }

  syncRateioCountsFromWorkspace(ws, ctx);

  if (turnCount(ctx, receiverUuid) <= receiverBefore) {
    return reject("RECEIVER_NO_GAIN", `antes=${receiverBefore}`);
  }

  if (turnCount(ctx, donorUuid) < (ctx.minTurnCounts.get(donorUuid) ?? 0)) {
    return reject("DONOR_BELOW_MIN_AFTER");
  }

  if (!transferStateValid(ws, ctx, donorUuid)) {
    const gaps = ws.listCoverageGaps().length;
    return reject("COVERAGE_GAPS_AFTER", `gaps=${gaps}`);
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

function donorTiersForPhase(phase: TransferPhase): DonorTier[] {
  return phase === "min" ? ["above_target", "above_min"] : ["above_target"];
}

function listDonorsForTier(
  ctx: ScheduleRateioContext,
  ws: GenerationWorkspace,
  tier: DonorTier,
): RankedEmployee[] {
  return tier === "above_target"
    ? listAboveTarget(ctx, ws)
    : listDonorsAboveMinNotTarget(ctx, ws);
}

function applyOneValidMinimumTransfer(ws: GenerationWorkspace): boolean {
  const ctx = syncCtx(ws);
  const receiverList = listBelowMinimum(ctx, ws);
  if (receiverList.length === 0) return false;

  for (const receiver of receiverList) {
    for (const tier of donorTiersForPhase("min")) {
      const donorList = listDonorsForTier(ctx, ws, tier);
      for (const donor of donorList) {
        if (!canDonorGiveForPhase(ctx, donor.uuid, "min", tier)) continue;
        for (const { day, shift } of listDonorAssignments(ws, donor.uuid, "min")) {
          if (trySameDayTransfer(ws, ctx, donor.uuid, receiver.uuid, day, shift, undefined, tier)) {
            syncCtx(ws);
            return true;
          }
        }
      }
    }
  }
  return false;
}

function runTransferPasses(
  ws: GenerationWorkspace,
  receivers: () => RankedEmployee[],
  stopWhenEmpty: () => boolean,
  options?: EnforceTurnTargetsOptions,
): number {
  const phase = options?.phase ?? "min";
  const collector = options?.audit;
  let transfers = 0;
  const acceptedEdges = new Set<string>();
  let prevDeficit = totalDeficitForPhase(syncCtx(ws), ws, phase);
  const maxPasses = maxPassesForPhase(syncCtx(ws), ws, phase);

  for (let pass = 0; pass < maxPasses; pass++) {
    if (stopWhenEmpty()) break;

    const ctx = syncCtx(ws);
    const receiverList = receivers();
    if (receiverList.length === 0) {
      collector?.recordPassNoReceivers();
      break;
    }

    let moved = false;
    let anyDonor = false;
    let stalledByChurn = false;

    for (const tier of donorTiersForPhase(phase)) {
      const donorList = listDonorsForTier(ctx, ws, tier);
      if (donorList.length === 0) continue;
      anyDonor = true;

      for (const receiver of receiverList) {
        for (const donor of donorList) {
          if (!canDonorGiveForPhase(ctx, donor.uuid, phase, tier)) continue;

          const auditCtx: TransferAuditContext | undefined = collector
            ? {
                collector,
                phase,
                pass,
                donorName: employeeName(ws, donor.uuid),
                receiverName: employeeName(ws, receiver.uuid),
                donorTier: tier,
              }
            : undefined;

          for (const { day, shift } of listDonorAssignments(ws, donor.uuid, phase)) {
            const reverseKey = transferEdgeKey(receiver.uuid, donor.uuid, day, shift);
            if (acceptedEdges.has(reverseKey)) continue;

            const passSnapshot = captureOptimizationSnapshot(ws);
            if (
              !trySameDayTransfer(
                ws,
                ctx,
                donor.uuid,
                receiver.uuid,
                day,
                shift,
                auditCtx,
              )
            ) {
              continue;
            }

            const newDeficit = totalDeficitForPhase(syncCtx(ws), ws, phase);
            if (newDeficit >= prevDeficit - 1e-9) {
              restoreOptimizationSnapshot(ws, passSnapshot);
              syncCtx(ws);
              stalledByChurn = true;
              break;
            }

            acceptedEdges.add(transferEdgeKey(donor.uuid, receiver.uuid, day, shift));
            prevDeficit = newDeficit;
            transfers++;
            moved = true;
            syncCtx(ws);
            break;
          }
          if (moved || stalledByChurn) break;
        }
        if (moved || stalledByChurn) break;
      }
      if (moved || stalledByChurn) break;
    }

    if (stalledByChurn) {
      collector?.recordPassBothFoundAllRejected();
      break;
    }

    if (!moved) {
      if (!anyDonor) collector?.recordPassNoDonors();
      else collector?.recordPassBothFoundAllRejected();
      break;
    }
  }

  return transfers;
}

function runMinimumTransferLoop(
  ws: GenerationWorkspace,
  options?: EnforceTurnTargetsOptions,
): number {
  let transfers = runTransferPasses(
    ws,
    () => listBelowMinimum(syncCtx(ws), ws),
    () => countBelowMin(syncCtx(ws), ws) === 0,
    { ...options, phase: "min" },
  );

  const maxExtra = maxPassesForPhase(syncCtx(ws), ws, "min");

  while (transfers < maxExtra && countBelowMin(syncCtx(ws), ws) > 0) {
    const beforeDeficit = totalMinDeficit(syncCtx(ws), ws);
    if (!applyOneValidMinimumTransfer(ws)) break;
    const afterDeficit = totalMinDeficit(syncCtx(ws), ws);
    if (afterDeficit >= beforeDeficit - 1e-9) break;
    transfers++;
  }

  while (transfers < maxExtra) {
    const pending = validateRateioMinimums(ws).issues.some((i) => i.hasValidTransfer);
    if (!pending) break;
    const beforeDeficit = totalMinDeficit(syncCtx(ws), ws);
    if (!applyOneValidMinimumTransfer(ws)) break;
    const afterDeficit = totalMinDeficit(syncCtx(ws), ws);
    if (afterDeficit >= beforeDeficit - 1e-9) break;
    transfers++;
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

  const transfers = runMinimumTransferLoop(ws, options);

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
  minimumAfterTarget: EnforceTurnTargetsReport;
  rateioMinimums: RateioMinimumValidation;
} {
  const minimum = enforceMinimumTurnTargets(ws, { audit: options?.audit, phase: "min" });
  const target = enforceTargetTurnTargets(ws, { audit: options?.audit, phase: "target" });
  const minimumAfterTarget = enforceMinimumTurnTargets(ws, { phase: "min" });
  const rateioMinimums = validateRateioMinimums(ws);

  if (ws.persistenceFocusTraceEnabled) {
    ws.persistenceFocusSnapshots.push(
      capturePersistenceFocus(
        ws,
        `depois enforceProportionalTurnTargets [${ws.v5PipelineStage || "?"}]`,
      ),
    );
  }

  return { minimum, target, minimumAfterTarget, rateioMinimums };
}

function scanValidTransferForReceiver(
  ws: GenerationWorkspace,
  receiverUuid: string,
): { exists: boolean; hint?: string } {
  const snapshot = captureOptimizationSnapshot(ws);
  let ctx = syncCtx(ws);

  for (const tier of donorTiersForPhase("min")) {
    const donors = listDonorsForTier(ctx, ws, tier);
    for (const donor of donors) {
      if (!canDonorGiveForPhase(ctx, donor.uuid, "min", tier)) continue;
      for (const { day, shift } of listDonorAssignments(ws, donor.uuid, "min")) {
        if (trySameDayTransfer(ws, ctx, donor.uuid, receiverUuid, day, shift, undefined, tier)) {
          const hint = `${employeeName(ws, donor.uuid)}→${employeeName(ws, receiverUuid)} ${shift}@${day}`;
          restoreOptimizationSnapshot(ws, snapshot);
          syncCtx(ws);
          return { exists: true, hint };
        }
      }
    }
  }

  restoreOptimizationSnapshot(ws, snapshot);
  syncCtx(ws);
  return { exists: false };
}

/** @internal Teste/diagnóstico — tenta transferência min e restaura o workspace. */
export function debugTryMinimumTransfer(
  ws: GenerationWorkspace,
  donorUuid: string,
  receiverUuid: string,
  day: string,
  shift: ShiftCode,
  donorTier: DonorTier = "above_target",
): boolean {
  const snapshot = captureOptimizationSnapshot(ws);
  const ctx = syncCtx(ws);
  const ok = trySameDayTransfer(ws, ctx, donorUuid, receiverUuid, day, shift, undefined, donorTier);
  restoreOptimizationSnapshot(ws, snapshot);
  syncCtx(ws);
  return ok;
}

/** Valida mínimos proporcionais; detecta transferências ainda possíveis. */
export function validateRateioMinimums(ws: GenerationWorkspace): RateioMinimumValidation {
  const ctx = syncCtx(ws);
  const issues: RateioMinimumIssue[] = [];

  for (const c of ws.paoEmps) {
    const cur = turnCount(ctx, c.uuid);
    const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
    if (cur >= min) continue;

    const scan = scanValidTransferForReceiver(ws, c.uuid);
    issues.push({
      name: employeeName(ws, c.uuid),
      uuid: c.uuid,
      current: cur,
      min,
      deficit: min - cur,
      hasValidTransfer: scan.exists,
      transferHint: scan.hint,
    });
  }

  return {
    ok: issues.every((i) => !i.hasValidTransfer),
    issues,
  };
}

export function formatRateioMinimumValidation(validation: RateioMinimumValidation): string {
  if (validation.issues.length === 0) {
    return "validateRateioMinimums: todos os PAOs >= min proporcional.";
  }
  const lines = ["validateRateioMinimums: PAOs abaixo do min:"];
  for (const i of validation.issues) {
    const tag = i.hasValidTransfer ? "FALHA (transferência válida existe)" : "ATENÇÃO (sem transferência viável)";
    lines.push(
      `  ${i.name}: ${i.current}/${i.min} (déficit ${i.deficit}) — ${tag}${i.transferHint ? ` | ${i.transferHint}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Garante que pré-alocações admin do input existam em planned/blocked/allocations. */
export function restoreInputLockedPreallocations(ws: GenerationWorkspace): void {
  for (const lock of ws.input.lockedAllocations) {
    const label = normalizeOperationalLabel(lock.label);
    const upper = label.toUpperCase();
    const did = ws.uuidToDomain.get(lock.employeeUuid);
    if (did == null) continue;
    const key = assignmentKey(did, lock.date);
    const times =
      lock.startTime && lock.endTime && upper.includes("SIMULADOR")
        ? { startTime: lock.startTime, endTime: lock.endTime }
        : undefined;

    if (isRateioTurnShiftCode(upper)) {
      ws.planned.set(key, upper);
      ws.blocked.delete(key);
      for (let i = ws.allocations.length - 1; i >= 0; i--) {
        const a = ws.allocations[i]!;
        if (a.employeeUuid === lock.employeeUuid && a.date === lock.date) {
          ws.allocations.splice(i, 1);
        }
      }
      continue;
    }

    ws.planned.delete(key);
    ws.blocked.set(key, label);
    for (let i = ws.allocations.length - 1; i >= 0; i--) {
      const a = ws.allocations[i]!;
      if (a.employeeUuid === lock.employeeUuid && a.date === lock.date) {
        ws.allocations.splice(i, 1);
      }
    }
    ws.allocations.push({
      employeeUuid: lock.employeeUuid,
      date: lock.date,
      label,
      startTime: times?.startTime,
      endTime: times?.endTime,
    });
  }
  const deduped: typeof ws.allocations = [];
  const seen = new Set<string>();
  for (const row of ws.allocations) {
    const key = `${row.employeeUuid}|${row.date}|${normalizeOperationalLabel(row.label).toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  ws.allocations.splice(0, ws.allocations.length, ...deduped);
  ws.clearCoverageGapsCache();
}

function applyCleanMinimumEnforceMerge(
  ws: GenerationWorkspace,
  input: GenerationInput,
): void {
  const templatePlanned = new Map(ws.planned);
  const templateAllocations = ws.allocations.map((a) => ({ ...a }));
  const templateBlocked = new Map(ws.blocked);

  const clean = new GenerationWorkspace(input);
  clean.applyHardBlocks();

  for (const a of ws.toAssignments()) {
    const did = clean.uuidToDomain.get(a.employeeUuid);
    if (did == null) continue;
    clean.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  for (const al of ws.allocations) {
    clean.allocations.push({ ...al });
  }
  for (const [key, label] of ws.blocked) {
    clean.blocked.set(key, label);
  }

  clean.initRateioContext();
  clean.syncRateioContext();

  for (let i = 0; i < 64; i++) {
    if (!validateRateioMinimums(clean).issues.some((x) => x.hasValidTransfer)) break;
    enforceProportionalTurnTargets(clean);
    clean.syncRateioContext();
    if (countBelowMin(clean.rateioContext!, clean) === 0) break;
  }

  ws.allocations.splice(0, ws.allocations.length, ...templateAllocations.map((a) => ({ ...a })));
  ws.blocked.clear();
  for (const [key, label] of templateBlocked) {
    ws.blocked.set(key, label);
  }
  ws.planned.clear();
  for (const [key, code] of templatePlanned) {
    ws.planned.set(key, code);
  }

  for (const c of ws.paoEmps) {
    for (const day of ws.days) {
      if (ws.isLockedByAdmin(c.uuid, day)) continue;
      const key = assignmentKey(c.domainId, day);
      const cleanCode = clean.planned.get(key);
      const tplCode = templatePlanned.get(key);
      if (cleanCode === tplCode) continue;

      if (cleanCode != null) {
        ws.planned.set(key, cleanCode);
        for (let i = ws.allocations.length - 1; i >= 0; i--) {
          const a = ws.allocations[i]!;
          if (a.employeeUuid === c.uuid && a.date === day) {
            ws.allocations.splice(i, 1);
          }
        }
        ws.blocked.delete(key);
      } else {
        ws.planned.delete(key);
      }
    }
  }
  ws.clearCoverageGapsCache();
}

/**
 * Garante mínimos proporcionais no grid persistido sem sobrescrever pré-alocações admin.
 */
export function finalizeMinimumTurnTargetsForSave(
  ws: GenerationWorkspace,
  input: GenerationInput,
): GenerationWorkspace {
  applyCleanMinimumEnforceMerge(ws, input);
  restoreInputLockedPreallocations(ws);

  for (let i = 0; i < 64; i++) {
    if (!validateRateioMinimums(ws).issues.some((x) => x.hasValidTransfer)) break;
    const report = enforceMinimumTurnTargets(ws);
    ws.syncRateioContext();
    if (report.transfers === 0) break;
  }

  restoreInputLockedPreallocations(ws);
  ws.syncRateioContext();
  ws.clearCoverageGapsCache();
  return ws;
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
