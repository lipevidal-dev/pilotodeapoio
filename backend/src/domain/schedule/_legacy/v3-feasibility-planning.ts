import type { GenerationWorkspace } from "./generation-workspace.js";
import type { IndividualTarget, EmployeeBlockPlan, PlannedBlock } from "./demand-planning-types.js";
import {
  blockDaysFromStart,
} from "./employee-t6-t7-shift.js";
import {
  findSpacedConsecutiveSlot,
  idealBlockSizeForTarget,
  idealBlockSpacing,
  listEmployeeAvailableDays,
  plannedBlockCountForTarget,
  targetToBlocksV3,
} from "./motor-v3-planning.js";
import { blockAnchorDaysAfterMonoFolgaPedida } from "./mono-folga-pedida.js";
import { tryPlaceBlock } from "./demand-planning-materialize.js";
import { assignmentKey } from "../types.js";

export interface V3FeasibilityMetrics {
  plannedTurns: number;
  materializedTurns: number;
  discardedTurns: number;
}

function groupOrder(group: IndividualTarget["group"]): number {
  if (group === "FULL_NO_FLIGHT") return 0;
  if (group === "VACATION") return 1;
  return 2;
}

function canPlaceWorkDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  if (ws.isDayBlockedForShift(uuid, day)) return false;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  return !ws.planned.has(assignmentKey(did, day));
}

/** Lista janelas consecutivas livres para bloco de tamanho size. */
export function listConsecutiveSlotCandidates(
  ws: GenerationWorkspace,
  uuid: string,
  size: number,
): string[] {
  if (size <= 0) return [];
  const maxStart = Math.max(0, ws.days.length - size);
  const out: string[] = [];
  for (let di = 0; di <= maxStart; di++) {
    let ok = true;
    for (let j = 0; j < size; j++) {
      if (!canPlaceWorkDay(ws, uuid, ws.days[di + j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(ws.days[di]!);
  }
  return out;
}

function orderSlotCandidates(
  candidates: string[],
  preferred: string[],
  idealStartDi: number,
  ws: GenerationWorkspace,
): string[] {
  const prefSet = new Set(preferred);
  return [...new Set(candidates)].sort((a, b) => {
    const prefA = prefSet.has(a) ? 0 : 1;
    const prefB = prefSet.has(b) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;
    const diA = ws.days.indexOf(a);
    const diB = ws.days.indexOf(b);
    const distA = Math.abs(diA - idealStartDi);
    const distB = Math.abs(diB - idealStartDi);
    return distA - distB || diA - diB || a.localeCompare(b);
  });
}

/**
 * Simula colocação de bloco T6/T7 — valida canWork, 12h, consecutivos, rateio,
 * T8/ND, pré-alocações, férias, FP, FANI via tryAssignShift (dry-run).
 */
export function simulateBlockPlacement(
  ws: GenerationWorkspace,
  uuid: string,
  startDay: string,
  size: number,
): boolean {
  const blockDays = blockDaysFromStart(startDay, size);
  return tryPlaceBlock(ws, uuid, startDay, size, blockDays, undefined, { dryRun: true }) != null;
}

/**
 * Planejamento V3 com viabilidade — só inclui blocos que passam simulateBlockPlacement.
 * Blocos viáveis são confirmados no workspace (estado acumulado por PAO/bloco).
 */
export function buildFeasibleBlockPlans(
  ws: GenerationWorkspace,
  targets: IndividualTarget[],
): EmployeeBlockPlan[] {
  const ordered = [...targets].sort(
    (a, b) =>
      groupOrder(a.group) - groupOrder(b.group) ||
      a.seniority - b.seniority,
  );

  return ordered.map((t) => {
    const nominalSizes = targetToBlocksV3(t.target);
    const initialAvailable = listEmployeeAvailableDays(ws, t.employeeUuid);
    const monoAnchors = blockAnchorDaysAfterMonoFolgaPedida(ws, t.employeeUuid);
    const feasibleBlocks: PlannedBlock[] = [];

    for (let blockIndex = 0; blockIndex < nominalSizes.length; blockIndex++) {
      const size = nominalSizes[blockIndex]!;
      const zf = nominalSizes.length;

      const spacedStart = findSpacedConsecutiveSlot(
        ws,
        t.employeeUuid,
        size,
        blockIndex,
        zf,
        initialAvailable,
        blockIndex === 0 ? monoAnchors : undefined,
      );
      const idealStartDi = spacedStart ? ws.days.indexOf(spacedStart) : 0;
      const allStarts = listConsecutiveSlotCandidates(ws, t.employeeUuid, size);
      const preferred = [
        ...(spacedStart ? [spacedStart] : []),
        ...(blockIndex === 0 ? monoAnchors : []),
      ];
      const candidates = orderSlotCandidates(allStarts, preferred, idealStartDi, ws);

      for (const start of candidates) {
        if (!simulateBlockPlacement(ws, t.employeeUuid, start, size)) continue;
        const blockDays = blockDaysFromStart(start, size);
        const code = tryPlaceBlock(ws, t.employeeUuid, start, size, blockDays);
        if (!code) continue;
        feasibleBlocks.push({ size, startDate: start, shiftCode: code });
        break;
      }
    }

    const bf = idealBlockSizeForTarget(t.target);
    const zf = plannedBlockCountForTarget(t.target);
    return {
      employeeUuid: t.employeeUuid,
      name: t.name,
      group: t.group,
      seniority: t.seniority,
      target: t.target,
      idealBlockSize: bf,
      plannedBlockCount: zf,
      blockSpacing: idealBlockSpacing(initialAvailable.length, feasibleBlocks.length || zf),
      plannedBlocks: feasibleBlocks,
      executedBlocks: [],
    };
  });
}

export function sumPlannedTurns(plans: { plannedBlocks: PlannedBlock[] }[]): number {
  return plans.reduce(
    (total, plan) => total + plan.plannedBlocks.reduce((n, b) => n + b.size, 0),
    0,
  );
}

export function buildFeasibilityMetrics(
  plans: { plannedBlocks: PlannedBlock[] }[],
  materializedTurns: number,
  discardedBlockShifts: number,
): V3FeasibilityMetrics {
  return {
    plannedTurns: sumPlannedTurns(plans),
    materializedTurns,
    discardedTurns: discardedBlockShifts,
  };
}
