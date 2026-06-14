import type { ShiftCode } from "./assignment-eligibility.js";

export type TransferRejectionCode =
  | "SAME_EMPLOYEE"
  | "DONOR_CANNOT_GIVE"
  | "DONOR_NO_SHIFT"
  | "DONOR_T8_PROTECTED"
  | "DONOR_ADMIN_LOCKED"
  | "RECEIVER_DAY_OCCUPIED"
  | "RECEIVER_BLOCKED"
  | "RATEIO_MAX"
  | "UNASSIGN_FAILED"
  | "ASSIGN_FAILED"
  | "RECEIVER_NO_GAIN"
  | "DONOR_BELOW_MIN_AFTER"
  | "COVERAGE_GAPS_AFTER";

export type TransferPhase = "min" | "target";

export interface TransferAttemptLog {
  phase: TransferPhase;
  pass: number;
  donorId: string;
  donorName: string;
  receiverId: string;
  receiverName: string;
  day: string;
  shift: ShiftCode;
  outcome: "accepted" | "rejected";
  reason: TransferRejectionCode | "ACCEPTED";
  detail?: string;
}

export interface V4TransferPhaseAudit {
  phase: TransferPhase;
  attemptsTotal: number;
  acceptedTotal: number;
  rejectionsByReason: Record<string, number>;
  rateioBlocked: number;
  noDonorPasses: number;
  noReceiverPasses: number;
  bothFoundAllRejectedPasses: number;
  rollbackAfterBothFound: number;
  belowMinBefore: number;
  belowMinAfter: number;
  belowTargetBefore: number;
  belowTargetAfter: number;
  attempts: TransferAttemptLog[];
}

export interface V4TransferAuditContext {
  belowMin: Array<{ name: string; current: number; min: number; deficit: number }>;
  aboveTarget: Array<{ name: string; current: number; target: number; excess: number }>;
}

export interface V4CombinedTransferAudit {
  context: V4TransferAuditContext;
  minimum: V4TransferPhaseAudit;
  target: V4TransferPhaseAudit;
  totals: {
    attemptsTotal: number;
    acceptedTotal: number;
    rateioBlocked: number;
    noDonorPasses: number;
    noReceiverPasses: number;
    bothFoundAllRejectedPasses: number;
    rollbackAfterBothFound: number;
  };
}

const MAX_LOGGED_ATTEMPTS = 2000;

export class V4TransferAuditCollector {
  private readonly attempts: TransferAttemptLog[] = [];
  private attemptsTotal = 0;
  private acceptedTotal = 0;
  private readonly rejectionsByReason = new Map<string, number>();
  private rateioBlocked = 0;
  private noDonorPasses = 0;
  private noReceiverPasses = 0;
  private bothFoundAllRejectedPasses = 0;
  private rollbackAfterBothFound = 0;

  recordPassNoReceivers(): void {
    this.noReceiverPasses++;
  }

  recordPassNoDonors(): void {
    this.noDonorPasses++;
  }

  recordPassBothFoundAllRejected(): void {
    this.bothFoundAllRejectedPasses++;
  }

  recordAttempt(
    entry: Omit<TransferAttemptLog, "outcome" | "reason"> & {
      outcome: "accepted" | "rejected";
      reason: TransferRejectionCode | "ACCEPTED";
      detail?: string;
    },
  ): void {
    this.attemptsTotal++;
    if (entry.outcome === "accepted") {
      this.acceptedTotal++;
    } else {
      const key = entry.reason;
      this.rejectionsByReason.set(key, (this.rejectionsByReason.get(key) ?? 0) + 1);
      if (entry.reason === "RATEIO_MAX") {
        this.rateioBlocked++;
      }
      if (
        entry.reason === "UNASSIGN_FAILED" ||
        entry.reason === "ASSIGN_FAILED" ||
        entry.reason === "RECEIVER_NO_GAIN" ||
        entry.reason === "DONOR_BELOW_MIN_AFTER" ||
        entry.reason === "COVERAGE_GAPS_AFTER"
      ) {
        this.rollbackAfterBothFound++;
      }
    }

    if (this.attempts.length < MAX_LOGGED_ATTEMPTS) {
      this.attempts.push({
        phase: entry.phase,
        pass: entry.pass,
        donorId: entry.donorId,
        donorName: entry.donorName,
        receiverId: entry.receiverId,
        receiverName: entry.receiverName,
        day: entry.day,
        shift: entry.shift,
        outcome: entry.outcome,
        reason: entry.reason,
        detail: entry.detail,
      });
    }
  }

  buildPhaseAudit(
    phase: TransferPhase,
    snapshot: Omit<
      V4TransferPhaseAudit,
      | "phase"
      | "attemptsTotal"
      | "acceptedTotal"
      | "rejectionsByReason"
      | "rateioBlocked"
      | "noDonorPasses"
      | "noReceiverPasses"
      | "bothFoundAllRejectedPasses"
      | "rollbackAfterBothFound"
      | "attempts"
    >,
  ): V4TransferPhaseAudit {
    return {
      phase,
      attemptsTotal: this.attemptsTotal,
      acceptedTotal: this.acceptedTotal,
      rejectionsByReason: Object.fromEntries(this.rejectionsByReason),
      rateioBlocked: this.rateioBlocked,
      noDonorPasses: this.noDonorPasses,
      noReceiverPasses: this.noReceiverPasses,
      bothFoundAllRejectedPasses: this.bothFoundAllRejectedPasses,
      rollbackAfterBothFound: this.rollbackAfterBothFound,
      attempts: [...this.attempts],
      ...snapshot,
    };
  }

  resetCounters(): void {
    this.attempts.length = 0;
    this.attemptsTotal = 0;
    this.acceptedTotal = 0;
    this.rejectionsByReason.clear();
    this.rateioBlocked = 0;
    this.noDonorPasses = 0;
    this.noReceiverPasses = 0;
    this.bothFoundAllRejectedPasses = 0;
    this.rollbackAfterBothFound = 0;
  }
}

function sumPhase(field: keyof V4TransferPhaseAudit, a: V4TransferPhaseAudit, b: V4TransferPhaseAudit): number {
  const va = a[field];
  const vb = b[field];
  if (typeof va === "number" && typeof vb === "number") return va + vb;
  return 0;
}

export function combineV4TransferAudits(
  context: V4TransferAuditContext,
  minimum: V4TransferPhaseAudit,
  target: V4TransferPhaseAudit,
): V4CombinedTransferAudit {
  return {
    context,
    minimum,
    target,
    totals: {
      attemptsTotal: sumPhase("attemptsTotal", minimum, target),
      acceptedTotal: sumPhase("acceptedTotal", minimum, target),
      rateioBlocked: sumPhase("rateioBlocked", minimum, target),
      noDonorPasses: sumPhase("noDonorPasses", minimum, target),
      noReceiverPasses: sumPhase("noReceiverPasses", minimum, target),
      bothFoundAllRejectedPasses: sumPhase("bothFoundAllRejectedPasses", minimum, target),
      rollbackAfterBothFound: sumPhase("rollbackAfterBothFound", minimum, target),
    },
  };
}

export function formatV4TransferAudit(audit: V4CombinedTransferAudit): string {
  const lines: string[] = ["===== V4 TRANSFER AUDIT ====="];

  lines.push("");
  lines.push("--- Contexto inicial (escala gerada) ---");
  if (audit.context.belowMin.length === 0) {
    lines.push("PAOs abaixo do min: (nenhum)");
  } else {
    lines.push("PAOs abaixo do min:");
    for (const p of audit.context.belowMin) {
      lines.push(`  ${p.name}: ${p.current}/${p.min} (déficit ${p.deficit})`);
    }
  }
  if (audit.context.aboveTarget.length === 0) {
    lines.push("PAOs acima do target: (nenhum)");
  } else {
    lines.push("PAOs acima do target:");
    for (const p of audit.context.aboveTarget) {
      lines.push(`  ${p.name}: ${p.current}/${p.target.toFixed(1)} (excesso ${p.excess.toFixed(1)})`);
    }
  }

  for (const phaseAudit of [audit.minimum, audit.target]) {
    lines.push("");
    lines.push(`--- Fase: ${phaseAudit.phase === "min" ? "meta mínima" : "meta target"} ---`);
    lines.push(`Tentativas: ${phaseAudit.attemptsTotal}`);
    lines.push(`Aceitas: ${phaseAudit.acceptedTotal}`);
    lines.push(`Abaixo min antes→depois: ${phaseAudit.belowMinBefore}→${phaseAudit.belowMinAfter}`);
    lines.push(
      `Abaixo target antes→depois: ${phaseAudit.belowTargetBefore}→${phaseAudit.belowTargetAfter}`,
    );
    lines.push(`Passes sem receptor: ${phaseAudit.noReceiverPasses}`);
    lines.push(`Passes sem doador: ${phaseAudit.noDonorPasses}`);
    lines.push(`Passes com ambos mas 0 aceites: ${phaseAudit.bothFoundAllRejectedPasses}`);
    lines.push(`Rollback após doador+receptor (ambos encontrados): ${phaseAudit.rollbackAfterBothFound}`);
    lines.push(`canAssignShiftWithRateio bloqueou: ${phaseAudit.rateioBlocked}`);

    const reasons = Object.entries(phaseAudit.rejectionsByReason).sort((a, b) => b[1] - a[1]);
    if (reasons.length > 0) {
      lines.push("Rejeições por motivo:");
      for (const [code, count] of reasons) {
        lines.push(`  ${code}: ${count}`);
      }
    } else {
      lines.push("Rejeições por motivo: (nenhuma)");
    }
  }

  lines.push("");
  lines.push("--- Totais (min + target) ---");
  lines.push(`Tentativas: ${audit.totals.attemptsTotal}`);
  lines.push(`Aceitas: ${audit.totals.acceptedTotal}`);
  lines.push(`canAssignShiftWithRateio bloqueou: ${audit.totals.rateioBlocked}`);
  lines.push(`Passes sem doador: ${audit.totals.noDonorPasses}`);
  lines.push(`Passes sem receptor: ${audit.totals.noReceiverPasses}`);
  lines.push(`Passes ambos sem aceite: ${audit.totals.bothFoundAllRejectedPasses}`);
  lines.push(`Rollbacks pós-par doador+receptor: ${audit.totals.rollbackAfterBothFound}`);

  lines.push("");
  lines.push("--- Amostra de tentativas (até 80) ---");
  const sample = [...audit.minimum.attempts, ...audit.target.attempts].slice(0, 80);
  if (sample.length === 0) {
    lines.push("(nenhuma tentativa registrada)");
  } else {
    for (const a of sample) {
      const tag = a.outcome === "accepted" ? "OK" : "REJ";
      lines.push(
        `[${tag}] ${a.phase} pass=${a.pass} | ${a.donorName}→${a.receiverName} | ${a.shift}@${a.day} | ${a.reason}${a.detail ? ` (${a.detail})` : ""}`,
      );
    }
    const totalLogged = audit.minimum.attempts.length + audit.target.attempts.length;
    if (totalLogged > 80) {
      lines.push(`... +${totalLogged - 80} tentativa(s) omitidas`);
    }
  }

  return lines.join("\n");
}
