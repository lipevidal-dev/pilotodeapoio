import { addDays } from "../../rules/dates.js";
import { sortPaoForT8CoverageCandidates } from "./t8-coverage-priority.js";
import { isNdOverrideProtected } from "./schedule-grid-source.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { assignmentKey } from "../types.js";
import {
  captureOptimizationSnapshot,
  restoreOptimizationSnapshot,
} from "./workspace-optimization-transaction.js";

function shiftCodeOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

/** Início do bloco T8/T8 (ou T8 isolado) que contém anchorDay. */
function resolveT8BlockStart(
  ws: GenerationWorkspace,
  uuid: string,
  anchorDay: string,
): string {
  if (shiftCodeOnDay(ws, uuid, anchorDay) !== "T8") return anchorDay;

  const prev = addDays(anchorDay, -1);
  const next = addDays(anchorDay, 1);
  const prevT8 = ws.days.includes(prev) && shiftCodeOnDay(ws, uuid, prev) === "T8";
  const nextT8 = ws.days.includes(next) && shiftCodeOnDay(ws, uuid, next) === "T8";

  if (prevT8 && !nextT8) {
    const beforePrev = addDays(prev, -1);
    if (ws.days.includes(beforePrev) && shiftCodeOnDay(ws, uuid, beforePrev) === "T8") {
      return beforePrev;
    }
    return prev;
  }
  if (!prevT8 && nextT8) return anchorDay;
  return anchorDay;
}

function isT8PairBlock(ws: GenerationWorkspace, uuid: string, blockStart: string): boolean {
  const d1 = addDays(blockStart, 1);
  return (
    shiftCodeOnDay(ws, uuid, blockStart) === "T8" &&
    ws.days.includes(d1) &&
    shiftCodeOnDay(ws, uuid, d1) === "T8"
  );
}

function clearGeneratedNd(ws: GenerationWorkspace, uuid: string, day: string): void {
  if (isNdOverrideProtected(ws, uuid, day)) return;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return;
  ws.blocked.delete(assignmentKey(did, day));
  const idx = ws.allocations.findIndex(
    (a) => a.employeeUuid === uuid && a.date === day && a.label === "ND",
  );
  if (idx >= 0) ws.allocations.splice(idx, 1);
  ws.clearCoverageGapsCache();
}

/** Remove bloco T8/T8/ND gerado para realocação de cobertura. */
function clearT8BlockForRelocation(
  ws: GenerationWorkspace,
  uuid: string,
  blockStart: string,
): void {
  const d0 = blockStart;
  const d1 = addDays(d0, 1);
  const ndDay = addDays(d0, 2);

  if (ws.days.includes(d1) && shiftCodeOnDay(ws, uuid, d1) === "T8") {
    ws.unassignShift(uuid, d1, { bypassT8Protection: true });
  }
  if (shiftCodeOnDay(ws, uuid, d0) === "T8") {
    ws.unassignShift(uuid, d0, { bypassT8Protection: true });
  }
  if (ws.days.includes(ndDay)) {
    clearGeneratedNd(ws, uuid, ndDay);
  }
  ws.clearEmergencyIsolatedT8(uuid, blockStart);
  if (ws.days.includes(d1)) ws.clearEmergencyIsolatedT8(uuid, d1);
  ws.clearCoverageGapsCache();
}

function priorT8BlocksGapShift(
  ws: GenerationWorkspace,
  gapDay: string,
  code: "T6" | "T7",
): string | undefined {
  const prevDay = addDays(gapDay, -1);
  if (!ws.days.includes(prevDay)) return undefined;

  const priorT8Holder = ws.findPaoOnShift(prevDay, "T8");
  if (!priorT8Holder) return undefined;

  const detail = ws.tryAssignShiftDetailed(priorT8Holder, gapDay, code, true);
  if (detail.ok || detail.reason !== "MIN_REST") return undefined;

  const withoutPrev = captureOptimizationSnapshot(ws);
  ws.unassignShift(priorT8Holder, prevDay, { bypassT8Protection: true });
  ws.syncRateioContext();
  const afterRemove = ws.tryAssignShiftDetailed(priorT8Holder, gapDay, code, false);
  restoreOptimizationSnapshot(ws, withoutPrev);
  ws.syncRateioContext();

  if (afterRemove.ok) return priorT8Holder;
  return undefined;
}

function tryRelocateT8Block(
  ws: GenerationWorkspace,
  fromUuid: string,
  blockStart: string,
  wasPair: boolean,
  gapDay: string,
  gapCode: "T6" | "T7",
  dayIndex: number,
  tryFillGap: (ws: GenerationWorkspace, day: string, code: "T6" | "T7", di: number) => boolean,
): boolean {
  const snap = captureOptimizationSnapshot(ws);
  clearT8BlockForRelocation(ws, fromUuid, blockStart);
  ws.syncRateioContext();

  const prevDay = addDays(gapDay, -1);
  const t8DayIndex = Math.max(0, ws.days.indexOf(wasPair ? blockStart : prevDay));
  const candidates = sortPaoForT8CoverageCandidates(ws, t8DayIndex, true).filter(
    (c) => c.uuid !== fromUuid,
  );

  for (const c of candidates) {
    const innerSnap = captureOptimizationSnapshot(ws);
    let relocated = false;

    if (wasPair) {
      relocated = ws.tryPlaceT8Block(c.uuid, blockStart, true);
    } else if (ws.days.includes(prevDay)) {
      relocated = ws.tryAssignShift(c.uuid, prevDay, "T8", true);
    }

    if (!relocated) continue;

    ws.syncRateioContext();
    if (tryFillGap(ws, gapDay, gapCode, dayIndex) && ws.hasPaoCoverage(gapDay, gapCode)) {
      return true;
    }

    restoreOptimizationSnapshot(ws, innerSnap);
    ws.syncRateioContext();
  }

  restoreOptimizationSnapshot(ws, snap);
  ws.syncRateioContext();
  return false;
}

/**
 * Gap T6/T7 causado por T8 no dia anterior (descanso < 12h):
 * realoca bloco T8/T8/ND ou T8 isolado antes de overflow emergencial.
 */
export function tryRepairT6T7GapBlockedByPriorT8(
  ws: GenerationWorkspace,
  gapDay: string,
  code: "T6" | "T7",
  dayIndex: number,
  tryFillGap: (ws: GenerationWorkspace, day: string, shift: "T6" | "T7", di: number) => boolean,
): boolean {
  if (ws.hasPaoCoverage(gapDay, code)) return true;

  const blockedHolder = priorT8BlocksGapShift(ws, gapDay, code);
  if (!blockedHolder) return false;

  const prevDay = addDays(gapDay, -1);
  const blockStart = resolveT8BlockStart(ws, blockedHolder, prevDay);
  const wasPair = isT8PairBlock(ws, blockedHolder, blockStart);

  if (
    tryRelocateT8Block(
      ws,
      blockedHolder,
      blockStart,
      wasPair,
      gapDay,
      code,
      dayIndex,
      tryFillGap,
    )
  ) {
    return true;
  }

  if (!wasPair && blockStart !== prevDay && shiftCodeOnDay(ws, blockedHolder, prevDay) === "T8") {
    const innerPair = isT8PairBlock(ws, blockedHolder, prevDay);
    return tryRelocateT8Block(
      ws,
      blockedHolder,
      prevDay,
      innerPair,
      gapDay,
      code,
      dayIndex,
      tryFillGap,
    );
  }

  return false;
}
