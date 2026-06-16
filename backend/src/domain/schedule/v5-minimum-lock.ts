import type { GenerationWorkspace } from "./generation-workspace.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import { currentTurnCount, type ScheduleRateioContext } from "./schedule-rateio-context.js";

export interface V56MinimumLockAuditEntry {
  date: string;
  employeeUuid: string;
  name: string;
  shift: string;
  stage: string;
  action: string;
  result: "BLOCKED" | "ALLOWED" | "MERGE_BLOCKED";
  reason: string;
}

export interface UnassignMinimumLockOpts {
  /** Ignora guarda V5.6 (rollback interno, fases pré-lock). */
  bypassMinimumLock?: boolean;
}

export function clearV56MinimumLockAudit(ws: GenerationWorkspace): void {
  ws.v56MinimumLockAudit.length = 0;
}

export function rateioTurnRemovalWeight(code: string | undefined): number {
  if (!code) return 0;
  return isRateioTurnShiftCode(code) ? 1 : 0;
}

/** Remover este turno deixaria o PAO abaixo do mínimo proporcional? */
export function wouldDropBelowMin(
  ws: GenerationWorkspace,
  uuid: string,
  shiftCode?: string,
): boolean {
  if (!ws.v56MinimumLockEnabled) return false;
  const ctx = ws.rateioContext;
  if (!ctx) return false;

  const min = ctx.minTurnCounts.get(uuid) ?? 0;
  if (min <= 0) return false;

  const current = currentTurnCount(ctx, uuid);
  const delta = shiftCode != null ? rateioTurnRemovalWeight(shiftCode) : 1;
  if (delta === 0) return false;

  return current - delta < min;
}

export function canUnassignMinimumLock(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shiftCode: string,
  opts?: UnassignMinimumLockOpts,
): boolean {
  if (opts?.bypassMinimumLock) return true;
  if (!wouldDropBelowMin(ws, uuid, shiftCode)) return true;

  logV56MinimumLock(ws, {
    date: day,
    employeeUuid: uuid,
    shift: shiftCode,
    action: "unassignShift",
    result: "BLOCKED",
    reason: "wouldDropBelowMin — sem reposição no mesmo ciclo",
  });
  return false;
}

export function logV56MinimumLock(
  ws: GenerationWorkspace,
  entry: Omit<V56MinimumLockAuditEntry, "name" | "stage"> & { name?: string; stage?: string },
): void {
  const stage = entry.stage ?? (ws.v5PipelineStage || "?");
  const last = ws.v56MinimumLockAudit[ws.v56MinimumLockAudit.length - 1];
  if (
    last &&
    last.result === entry.result &&
    last.action === entry.action &&
    last.date === entry.date &&
    last.employeeUuid === entry.employeeUuid &&
    last.shift === entry.shift &&
    last.stage === stage &&
    last.reason === entry.reason
  ) {
    return;
  }

  const emp = ws.input.employees.find((e) => e.uuid === entry.employeeUuid);
  ws.v56MinimumLockAudit.push({
    date: entry.date,
    employeeUuid: entry.employeeUuid,
    name: entry.name ?? emp?.employee.name ?? entry.employeeUuid,
    shift: entry.shift,
    stage,
    action: entry.action,
    result: entry.result,
    reason: entry.reason,
  });
}

/** Valida merge scratch → vivo sem derrubar PAO que estava no/até o mínimo. */
export function validateMergePreservesMinimumLock(
  ws: GenerationWorkspace,
  scratch: GenerationWorkspace,
): { ok: true } | { ok: false; name: string; before: number; after: number; min: number } {
  if (!ws.v56MinimumLockEnabled) return { ok: true };

  ws.syncRateioContext();
  scratch.syncRateioContext();
  const liveCtx = ws.rateioContext!;
  const scratchCtx = scratch.rateioContext!;

  for (const c of ws.paoEmps) {
    const min = liveCtx.minTurnCounts.get(c.uuid) ?? 0;
    if (min <= 0) continue;
    const before = currentTurnCount(liveCtx, c.uuid);
    const after = currentTurnCount(scratchCtx, c.uuid);
    if (before >= min && after < min) {
      logV56MinimumLock(ws, {
        date: "",
        employeeUuid: c.uuid,
        shift: "",
        action: "repairCoverageGapsBeforeSave.merge",
        result: "MERGE_BLOCKED",
        reason: `merge derrubaria ${before}→${after} (min=${min})`,
      });
      return { ok: false, name: c.employee.name, before, after, min };
    }
  }
  return { ok: true };
}

export function formatV56MinimumLockAudit(ws: GenerationWorkspace): string {
  const lines: string[] = [
    "===== V5.6 MINIMUM LOCK =====",
    "data | funcionário | turno | etapa | ação | resultado | motivo",
  ];

  if (ws.v56MinimumLockAudit.length === 0) {
    lines.push("(nenhum evento registrado)");
    return lines.join("\n");
  }

  const show = ws.v56MinimumLockAudit.slice(-120);
  for (const e of show) {
    lines.push(
      `${e.date || "—"} | ${e.name} | ${e.shift || "—"} | ${e.stage} | ${e.action} | ${e.result} | ${e.reason}`,
    );
  }
  if (ws.v56MinimumLockAudit.length > show.length) {
    lines.push(`… +${ws.v56MinimumLockAudit.length - show.length} evento(s) anterior(es)`);
  }
  return lines.join("\n");
}

/** Bloqueia transferência se doador cairia abaixo do mínimo (sem compensação). */
export function rejectTransferIfWouldDropDonorBelowMin(
  ws: GenerationWorkspace,
  donorUuid: string,
  day: string,
  shift: string,
): string | null {
  if (!wouldDropBelowMin(ws, donorUuid, shift)) return null;
  logV56MinimumLock(ws, {
    date: day,
    employeeUuid: donorUuid,
    shift,
    action: "transferShift",
    result: "BLOCKED",
    reason: "doador wouldDropBelowMin",
  });
  return "DONOR_MINIMUM_LOCK";
}

/** Dedup: preferir remover PAO que não cairia abaixo do mínimo. */
export function sortDedupRemovalCandidates(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  onShift: Array<{ uuid: string; seniority: number; name: string }>,
): typeof onShift {
  return [...onShift].sort((a, b) => {
    const dropA = wouldDropBelowMin(ws, a.uuid) ? 1 : 0;
    const dropB = wouldDropBelowMin(ws, b.uuid) ? 1 : 0;
    if (dropA !== dropB) return dropB - dropA;

    const belowA = (ctx.minTurnCounts.get(a.uuid) ?? 0) > currentTurnCount(ctx, a.uuid) ? 0 : 1;
    const belowB = (ctx.minTurnCounts.get(b.uuid) ?? 0) > currentTurnCount(ctx, b.uuid) ? 0 : 1;
    if (belowA !== belowB) return belowA - belowB;

    const rankCmp = comparePaoPoolRankFromCtx(ctx, a.uuid, b.uuid);
    if (rankCmp !== 0) return rankCmp;
    return a.seniority - b.seniority || a.name.localeCompare(b.name, "pt-BR");
  });
}

function comparePaoPoolRankFromCtx(
  ctx: ScheduleRateioContext,
  aUuid: string,
  bUuid: string,
): number {
  const rankA = ctx.paoPoolSeniorityByEmployee.get(aUuid)?.poolRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = ctx.paoPoolSeniorityByEmployee.get(bUuid)?.poolRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return aUuid.localeCompare(bUuid);
}
