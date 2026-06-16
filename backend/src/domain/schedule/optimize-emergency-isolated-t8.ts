import { addDays } from "../rules/dates.js";
import { finalizeT8NdBlocks } from "./schedule-grid-source.js";
import { computeTurnRateio, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  captureOptimizationSnapshot,
  restoreOptimizationSnapshot,
  tryOptimizationMutation,
  validateFullShiftCoverage,
  validateOptimizationState,
} from "./workspace-optimization-transaction.js";

export interface IsolatedT8Entry {
  employeeUuid: string;
  date: string;
  employeeName: string;
  emergency: boolean;
}

export interface UnresolvedIsolatedT8 {
  employeeUuid: string;
  date: string;
  employeeName: string;
  reason: string;
}

export interface OptimizeEmergencyIsolatedT8Result {
  isolatedBefore: number;
  isolatedAfter: number;
  converted: number;
  rolledBack: boolean;
  rollbackReason?: string;
  actions: string[];
  unresolved: UnresolvedIsolatedT8[];
}

function shiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

export function listIsolatedT8Entries(ws: GenerationWorkspace): IsolatedT8Entry[] {
  const out: IsolatedT8Entry[] = [];

  for (const c of ws.paoEmps) {
    for (const day of ws.days) {
      if (shiftOnDay(ws, c.uuid, day) !== "T8") continue;

      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const prevT8 = ws.days.includes(prev) && shiftOnDay(ws, c.uuid, prev) === "T8";
      const nextT8 = ws.days.includes(next) && shiftOnDay(ws, c.uuid, next) === "T8";

      if (!prevT8 && !nextT8) {
        out.push({
          employeeUuid: c.uuid,
          date: day,
          employeeName: c.employee.name,
          emergency: ws.isEmergencyIsolatedT8(c.uuid, day),
        });
      }
    }
  }

  return out.sort(
    (a, b) =>
      ws.days.indexOf(a.date) - ws.days.indexOf(b.date) ||
      a.employeeName.localeCompare(b.employeeName, "pt-BR"),
  );
}

function coverageCandidates(ws: GenerationWorkspace, dayIndex: number) {
  const entries = computeTurnRateio(ws).entries;
  return sortPaoForCoverageCandidates(ws, dayIndex, entries, "T8").filter(
    (c) => !isParallelOnlyPreferredPao(ws, c.uuid),
  );
}

function isIsolatedT8(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  if (shiftOnDay(ws, uuid, day) !== "T8") return false;
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const prevT8 = ws.days.includes(prev) && shiftOnDay(ws, uuid, prev) === "T8";
  const nextT8 = ws.days.includes(next) && shiftOnDay(ws, uuid, next) === "T8";
  return !prevT8 && !nextT8;
}

function tryExtendBlockForward(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): { ok: boolean; reason: string } {
  const baseline = captureOptimizationSnapshot(ws);
  return tryOptimizationMutation(ws, baseline, () => {
    ws.tryPlaceT8Block(uuid, day, true);
    finalizeT8NdBlocks(ws);
  });
}

function tryExtendBlockBackward(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): { ok: boolean; reason: string } {
  const prev = addDays(day, -1);
  if (!ws.days.includes(prev)) return { ok: false, reason: "D-1_FORA_MES" };

  const baseline = captureOptimizationSnapshot(ws);
  return tryOptimizationMutation(ws, baseline, () => {
    ws.tryPlaceT8Block(uuid, prev, true);
    finalizeT8NdBlocks(ws);
  });
}

function tryReassignBlockToCandidate(
  ws: GenerationWorkspace,
  gapDay: string,
  fromUuid: string,
  candidateUuid: string,
): { ok: boolean; reason: string } {
  const baseline = captureOptimizationSnapshot(ws);

  return tryOptimizationMutation(ws, baseline, () => {
    ws.unassignShift(fromUuid, gapDay, { bypassT8Protection: true });
    ws.clearEmergencyIsolatedT8(fromUuid, gapDay);
    ws.tryPlaceT8Block(candidateUuid, gapDay, true);
    finalizeT8NdBlocks(ws);
  });
}

function tryAdjacentPairMerge(
  ws: GenerationWorkspace,
  uuidA: string,
  dayA: string,
  uuidB: string,
  dayB: string,
  blockStart: string,
): { ok: boolean; reason: string } {
  const baseline = captureOptimizationSnapshot(ws);

  return tryOptimizationMutation(ws, baseline, () => {
    ws.unassignShift(uuidA, dayA, { bypassT8Protection: true });
    ws.unassignShift(uuidB, dayB, { bypassT8Protection: true });
    ws.clearEmergencyIsolatedT8(uuidA, dayA);
    ws.clearEmergencyIsolatedT8(uuidB, dayB);

    const di = Math.max(0, ws.days.indexOf(blockStart));
    const candidates = coverageCandidates(ws, di);

    let placed = false;
    for (const c of candidates) {
      if (ws.tryPlaceT8Block(c.uuid, blockStart, true)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (const c of ws.paoEmps) {
        if (isParallelOnlyPreferredPao(ws, c.uuid)) continue;
        if (ws.tryPlaceT8Block(c.uuid, blockStart, true)) {
          placed = true;
          break;
        }
      }
    }
    if (placed) finalizeT8NdBlocks(ws);
  });
}

function explainBlockFailure(ws: GenerationWorkspace, uuid: string, day: string): string {
  if (ws.isDayBlockedForShift(uuid, day)) return "DIA_BLOQUEADO";
  if (ws.isLockedByAdmin(uuid, day)) return "PREALOCACAO_FIXA";

  const next = addDays(day, 1);
  const prev = addDays(day, -1);

  if (ws.days.includes(next) && !ws.canPlaceT8Block(uuid, day, true)) {
    if (ws.isDayBlockedForShift(uuid, next)) return "D+1_BLOQUEADO";
    return "T8_BLOCK_IMPOSSIVEL_D_D+1";
  }
  if (ws.days.includes(prev) && !ws.canPlaceT8Block(uuid, prev, true)) {
    return "T8_BLOCK_IMPOSSIVEL_D-1_D";
  }
  if (!ws.canPlaceT8Block(uuid, day, true)) return "T8_BLOCK_IMPOSSIVEL";

  return "SEM_CANDIDATO_ELEGIVEL";
}

function attemptConvertIsolated(
  ws: GenerationWorkspace,
  entry: IsolatedT8Entry,
  actions: string[],
): boolean {
  const { employeeUuid, date: day } = entry;
  const dayIndex = Math.max(0, ws.days.indexOf(day));

  if (!isIsolatedT8(ws, employeeUuid, day)) return true;

  let result = tryExtendBlockForward(ws, employeeUuid, day);
  if (result.ok && !isIsolatedT8(ws, employeeUuid, day)) {
    ws.clearEmergencyIsolatedT8(employeeUuid, day);
    actions.push(`${entry.employeeName}@${day}: bloco forward D,D+1,D+2`);
    return true;
  }

  result = tryExtendBlockBackward(ws, employeeUuid, day);
  if (result.ok && !isIsolatedT8(ws, employeeUuid, day)) {
    ws.clearEmergencyIsolatedT8(employeeUuid, day);
    actions.push(`${entry.employeeName}@${day}: bloco backward D-1,D,D+1`);
    return true;
  }

  for (const c of coverageCandidates(ws, dayIndex)) {
    if (c.uuid === employeeUuid) continue;
    result = tryReassignBlockToCandidate(ws, day, employeeUuid, c.uuid);
    if (result.ok && ws.hasPaoCoverage(day, "T8") && !isIsolatedT8(ws, employeeUuid, day)) {
      actions.push(`${entry.employeeName}@${day} → bloco ${c.employee.name} (abaixo meta)`);
      return true;
    }
  }

  const next = addDays(day, 1);
  if (ws.days.includes(next)) {
    for (const c of ws.paoEmps) {
      if (c.uuid === employeeUuid) continue;
      if (shiftOnDay(ws, c.uuid, next) !== "T8") continue;
      if (!isIsolatedT8(ws, c.uuid, next)) continue;

      result = tryAdjacentPairMerge(ws, employeeUuid, day, c.uuid, next, day);
      if (result.ok && ws.hasPaoCoverage(day, "T8")) {
        actions.push(`${entry.employeeName}@${day} + ${c.employee.name}@${next}: merge bloco`);
        return true;
      }
    }
  }

  const prev = addDays(day, -1);
  if (ws.days.includes(prev)) {
    for (const c of ws.paoEmps) {
      if (c.uuid === employeeUuid) continue;
      if (shiftOnDay(ws, c.uuid, prev) !== "T8") continue;
      if (!isIsolatedT8(ws, c.uuid, prev)) continue;

      result = tryAdjacentPairMerge(ws, c.uuid, prev, employeeUuid, day, prev);
      if (result.ok && ws.hasPaoCoverage(day, "T8")) {
        actions.push(`${c.employee.name}@${prev} + ${entry.employeeName}@${day}: merge bloco`);
        return true;
      }
    }
  }

  return false;
}

function diagnoseUnresolved(ws: GenerationWorkspace, entry: IsolatedT8Entry): string {
  const reasons: string[] = [explainBlockFailure(ws, entry.employeeUuid, entry.date)];

  const day = entry.date;
  const uuid = entry.employeeUuid;
  const next = addDays(day, 1);
  const prev = addDays(day, -1);

  if (ws.days.includes(next) && !ws.canPlaceT8Block(uuid, day, true)) {
    reasons.push("CAN_PLACE_BLOCK_FORWARD_NAO");
  }
  if (ws.days.includes(prev) && !ws.canPlaceT8Block(uuid, prev, true)) {
    reasons.push("CAN_PLACE_BLOCK_BACKWARD_NAO");
  }

  const dayIndex = Math.max(0, ws.days.indexOf(day));
  const candidates = coverageCandidates(ws, dayIndex).filter((c) => c.uuid !== uuid);
  if (candidates.length === 0) {
    reasons.push("SEM_PAO_CANDIDATO");
  } else {
    const belowMin = candidates.filter((c) => {
      const ctx = ws.rateioContext!;
      const cur = ctx.currentTurnCounts.get(c.uuid) ?? 0;
      const min = ctx.minTurnCounts.get(c.uuid) ?? 0;
      return cur < min;
    });
    if (belowMin.length === 0) reasons.push("SEM_PAO_ABAIXO_MIN");
  }

  return [...new Set(reasons)].slice(0, 5).join("; ");
}

function rollbackOptimizationResult(
  ws: GenerationWorkspace,
  baseline: ReturnType<typeof captureOptimizationSnapshot>,
  isolatedBefore: number,
  reason: string,
): OptimizeEmergencyIsolatedT8Result {
  restoreOptimizationSnapshot(ws, baseline);
  finalizeT8NdBlocks(ws);
  ws.clearCoverageGapsCache();
  return {
    isolatedBefore,
    isolatedAfter: listIsolatedT8Entries(ws).length,
    converted: 0,
    rolledBack: true,
    rollbackReason: reason,
    actions: [],
    unresolved: listIsolatedT8Entries(ws).map((e) => ({
      employeeUuid: e.employeeUuid,
      date: e.date,
      employeeName: e.employeeName,
      reason: diagnoseUnresolved(ws, e),
    })),
  };
}

/**
 * Converte T8 isolados emergenciais em blocos T8/T8/ND quando possível.
 * Sempre transacional — rollback se cobertura ou pré-alocações quebrarem.
 */
export function optimizeEmergencyIsolatedT8(
  ws: GenerationWorkspace,
  _ctx: ScheduleRateioContext,
): OptimizeEmergencyIsolatedT8Result {
  ws.ensureRateioContext();
  const baseline = captureOptimizationSnapshot(ws);
  const actions: string[] = [];
  const isolatedBefore = listIsolatedT8Entries(ws).length;

  for (let pass = 0; pass < 4; pass++) {
    let progress = false;
    const batch = listIsolatedT8Entries(ws);

    for (const entry of batch) {
      if (attemptConvertIsolated(ws, entry, actions)) {
        progress = true;
      }
    }

    if (!progress) break;
  }

  finalizeT8NdBlocks(ws);
  ws.clearCoverageGapsCache();

  const coverage = validateFullShiftCoverage(ws);
  const validation = validateOptimizationState(ws, baseline);
  if (!coverage.ok || !validation.ok) {
    return rollbackOptimizationResult(
      ws,
      baseline,
      isolatedBefore,
      !coverage.ok ? coverage.reason : validation.reason,
    );
  }

  const remaining = listIsolatedT8Entries(ws);
  const unresolved: UnresolvedIsolatedT8[] = remaining.map((e) => ({
    employeeUuid: e.employeeUuid,
    date: e.date,
    employeeName: e.employeeName,
    reason: diagnoseUnresolved(ws, e),
  }));

  return {
    isolatedBefore,
    isolatedAfter: remaining.length,
    converted: Math.max(0, isolatedBefore - remaining.length),
    rolledBack: false,
    actions,
    unresolved,
  };
}

export function formatIsolatedT8OptimizationReport(
  result: OptimizeEmergencyIsolatedT8Result,
): string {
  const lines: string[] = [
    "===== T8 ISOLADO — OTIMIZAÇÃO =====",
    `Antes: ${result.isolatedBefore}; convertidos: ${result.converted}; restantes: ${result.isolatedAfter}` +
      (result.rolledBack ? ` (rollback: ${result.rollbackReason ?? "?"})` : ""),
  ];

  if (result.actions.length > 0) {
    lines.push("Conversões:");
    for (const a of result.actions) lines.push(`  ✓ ${a}`);
  }

  if (result.unresolved.length > 0) {
    lines.push("Não convertidos (motivo):");
    for (const u of result.unresolved) {
      lines.push(`  ${u.employeeName} @ ${u.date}: ${u.reason}`);
    }
  }

  return lines.join("\n");
}

export function buildIsolatedT8UnresolvedReport(ws: GenerationWorkspace): string {
  const entries = listIsolatedT8Entries(ws);
  return formatIsolatedT8OptimizationReport({
    isolatedBefore: entries.length,
    isolatedAfter: entries.length,
    converted: 0,
    rolledBack: false,
    actions: [],
    unresolved: entries.map((e) => ({
      employeeUuid: e.employeeUuid,
      date: e.date,
      employeeName: e.employeeName,
      reason: diagnoseUnresolved(ws, e),
    })),
  });
}
