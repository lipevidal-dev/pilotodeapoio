import { listParallelShiftCodes } from "../shift/coverage-type.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  computeProportionalTurnTargets,
} from "./pao-turn-availability.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import { buildSeniorityWeightIndex, preferenceScoreForShift, targetTurnDeficit } from "./preference-scoring.js";
import { buildPaoPoolSeniorityIndex, comparePaoPoolRank, type PaoPoolSeniorityInfo } from "./pao-pool-seniority.js";

export type { ShiftCode };

export interface ScheduleRateioContext {
  daysInMonth: number;

  mainPoolEmployeeIds: Set<string>;
  t8PoolEmployeeIds: Set<string>;
  t9PoolEmployeeIds: Set<string>;

  minTurnCounts: Map<string, number>;
  targetTurnCounts: Map<string, number>;
  maxTurnCounts: Map<string, number>;

  currentTurnCounts: Map<string, number>;
  currentT6Counts: Map<string, number>;
  currentT7Counts: Map<string, number>;
  currentT8Counts: Map<string, number>;
  currentT9Counts: Map<string, number>;

  preferredShiftByEmployee: Map<string, ShiftCode | null>;

  /** Peso de senioridade 1.0–1.5 para preferência ponderada. */
  seniorityWeightByEmployee: Map<string, number>;
  /** Posição relativa no pool PAO (APAO excluído). */
  paoPoolSeniorityByEmployee: Map<string, PaoPoolSeniorityInfo>;
  availableDaysByEmployee: Map<string, number>;
  relativeAvailabilityByEmployee: Map<string, number>;
  poolAverageAvailableDays: number;
  baseAverageTurns: number;

  overflowEvents: string[];
}

function resolvePreferredShift(
  ws: GenerationWorkspace,
  uuid: string,
): ShiftCode | null {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return null;
  const preferred = ws.input.preferredShifts?.get(did);
  if (!preferred || preferred.size === 0) return null;

  const order: ShiftCode[] = ["T6", "T7", "T8", "T9"];
  const parallel = new Set(listParallelShiftCodes(ws.input.shifts));
  for (const code of order) {
    if (preferred.has(code)) return code;
  }
  for (const code of preferred) {
    const upper = code.toUpperCase();
    if (order.includes(upper as ShiftCode)) return upper as ShiftCode;
    if (parallel.has(upper)) return "T9";
  }
  return null;
}

function isT9PoolMember(ws: GenerationWorkspace, uuid: string): boolean {
  return isParallelOnlyPreferredPao(ws, uuid);
}

function emptyCounts(uuids: string[]): Map<string, number> {
  return new Map(uuids.map((id) => [id, 0]));
}

/** Fonte única de verdade — pools e limites min/target/max. */
export function buildScheduleRateioContext(ws: GenerationWorkspace): ScheduleRateioContext {
  const daysInMonth = ws.days.length;
  const allUuids = ws.paoEmps.map((c) => c.uuid);

  const mainPoolEmployeeIds = new Set<string>();
  const t9PoolEmployeeIds = new Set<string>();
  const t8PoolEmployeeIds = new Set<string>(allUuids);

  for (const c of ws.paoEmps) {
    if (isT9PoolMember(ws, c.uuid)) {
      t9PoolEmployeeIds.add(c.uuid);
    } else {
      mainPoolEmployeeIds.add(c.uuid);
    }
  }

  const totalMainShifts = daysInMonth * 3;
  const mainPoolList = [...mainPoolEmployeeIds];
  const allPoolList = [...allUuids];

  const mainTargets = computeProportionalTurnTargets(ws, mainPoolList, totalMainShifts);
  const allTargets = computeProportionalTurnTargets(ws, allPoolList, totalMainShifts);

  const minTurnCounts = new Map<string, number>();
  const targetTurnCounts = new Map<string, number>();
  const maxTurnCounts = new Map<string, number>();
  const preferredShiftByEmployee = new Map<string, ShiftCode | null>();
  const seniorityWeightByEmployee = buildSeniorityWeightIndex(ws);
  const paoPoolSeniorityByEmployee = buildPaoPoolSeniorityIndex(ws);
  const availableDaysByEmployee = new Map<string, number>();
  const relativeAvailabilityByEmployee = new Map<string, number>();

  for (const uuid of allUuids) {
    preferredShiftByEmployee.set(uuid, resolvePreferredShift(ws, uuid));

    const src = mainPoolEmployeeIds.has(uuid) ? mainTargets : allTargets;
    minTurnCounts.set(uuid, src.minTurnCounts.get(uuid) ?? 0);
    targetTurnCounts.set(uuid, src.targetTurnCounts.get(uuid) ?? 0);
    maxTurnCounts.set(uuid, src.maxTurnCounts.get(uuid) ?? 0);
    availableDaysByEmployee.set(uuid, src.availableDaysByEmployee.get(uuid) ?? daysInMonth);
    relativeAvailabilityByEmployee.set(uuid, src.relativeAvailabilityByEmployee.get(uuid) ?? 1);
  }

  const poolAverageAvailableDays = mainTargets.poolAverageAvailableDays;
  const baseAverageTurns = mainTargets.baseAverageTurns;

  const ctx: ScheduleRateioContext = {
    daysInMonth,
    mainPoolEmployeeIds,
    t8PoolEmployeeIds,
    t9PoolEmployeeIds,
    minTurnCounts,
    targetTurnCounts,
    maxTurnCounts,
    currentTurnCounts: emptyCounts(allUuids),
    currentT6Counts: emptyCounts(allUuids),
    currentT7Counts: emptyCounts(allUuids),
    currentT8Counts: emptyCounts(allUuids),
    currentT9Counts: emptyCounts(allUuids),
    preferredShiftByEmployee,
    seniorityWeightByEmployee,
    paoPoolSeniorityByEmployee,
    availableDaysByEmployee,
    relativeAvailabilityByEmployee,
    poolAverageAvailableDays,
    baseAverageTurns,
    overflowEvents: [],
  };

  syncRateioCountsFromWorkspace(ws, ctx);
  return ctx;
}

export function syncRateioCountsFromWorkspace(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): void {
  for (const uuid of ctx.currentTurnCounts.keys()) {
    ctx.currentTurnCounts.set(uuid, 0);
    ctx.currentT6Counts.set(uuid, 0);
    ctx.currentT7Counts.set(uuid, 0);
    ctx.currentT8Counts.set(uuid, 0);
    ctx.currentT9Counts.set(uuid, 0);
  }

  for (const a of ws.toAssignments()) {
    if (!isRateioTurnShiftCode(a.shiftCode)) continue;
    recordRateioAssignment(ctx, a.employeeUuid, a.shiftCode);
  }

  for (const uuid of ctx.currentTurnCounts.keys()) {
    const total =
      (ctx.currentT6Counts.get(uuid) ?? 0) +
      (ctx.currentT7Counts.get(uuid) ?? 0) +
      (ctx.currentT8Counts.get(uuid) ?? 0) +
      (ctx.currentT9Counts.get(uuid) ?? 0);
    ctx.currentTurnCounts.set(uuid, total);
  }
}

export function recordRateioAssignment(
  ctx: ScheduleRateioContext,
  employeeId: string,
  shiftCode: string,
): void {
  if (!isRateioTurnShiftCode(shiftCode)) return;

  const code = shiftCode.toUpperCase();
  if (code === "T6") {
    ctx.currentT6Counts.set(employeeId, (ctx.currentT6Counts.get(employeeId) ?? 0) + 1);
  } else if (code === "T7") {
    ctx.currentT7Counts.set(employeeId, (ctx.currentT7Counts.get(employeeId) ?? 0) + 1);
  } else if (code === "T8") {
    ctx.currentT8Counts.set(employeeId, (ctx.currentT8Counts.get(employeeId) ?? 0) + 1);
  } else if (code === "T9") {
    ctx.currentT9Counts.set(employeeId, (ctx.currentT9Counts.get(employeeId) ?? 0) + 1);
  }
  ctx.currentTurnCounts.set(
    employeeId,
    (ctx.currentTurnCounts.get(employeeId) ?? 0) + 1,
  );
}

export function recordRateioUnassignment(
  ctx: ScheduleRateioContext,
  employeeId: string,
  shiftCode: string,
): void {
  if (!isRateioTurnShiftCode(shiftCode)) return;

  const code = shiftCode.toUpperCase();
  if (code === "T6") {
    ctx.currentT6Counts.set(employeeId, Math.max(0, (ctx.currentT6Counts.get(employeeId) ?? 0) - 1));
  } else if (code === "T7") {
    ctx.currentT7Counts.set(employeeId, Math.max(0, (ctx.currentT7Counts.get(employeeId) ?? 0) - 1));
  } else if (code === "T8") {
    ctx.currentT8Counts.set(employeeId, Math.max(0, (ctx.currentT8Counts.get(employeeId) ?? 0) - 1));
  } else if (code === "T9") {
    ctx.currentT9Counts.set(employeeId, Math.max(0, (ctx.currentT9Counts.get(employeeId) ?? 0) - 1));
  }
  ctx.currentTurnCounts.set(
    employeeId,
    Math.max(0, (ctx.currentTurnCounts.get(employeeId) ?? 0) - 1),
  );
}

export function currentTurnCount(ctx: ScheduleRateioContext, employeeId: string): number {
  return (
    (ctx.currentT6Counts.get(employeeId) ?? 0) +
    (ctx.currentT7Counts.get(employeeId) ?? 0) +
    (ctx.currentT8Counts.get(employeeId) ?? 0) +
    (ctx.currentT9Counts.get(employeeId) ?? 0)
  );
}

export function isBelowMaxTurns(ctx: ScheduleRateioContext, employeeId: string): boolean {
  const max = ctx.maxTurnCounts.get(employeeId);
  if (max === undefined) return true;
  return currentTurnCount(ctx, employeeId) < max;
}

export function isBelowMinTurns(ctx: ScheduleRateioContext, employeeId: string): boolean {
  const min = ctx.minTurnCounts.get(employeeId) ?? 0;
  return currentTurnCount(ctx, employeeId) < min;
}

export function minTurnDeficit(ctx: ScheduleRateioContext, employeeId: string): number {
  const min = ctx.minTurnCounts.get(employeeId) ?? 0;
  return Math.max(0, min - currentTurnCount(ctx, employeeId));
}

/** Ordena PAOs: abaixo do min, déficit target, preferência×senioridade, turnos, senioridade. */
export function sortPaoByRateioPriority(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  shift: ShiftCode,
  candidates: readonly { uuid: string; seniority: number }[],
  options?: { allowAtMax?: boolean; allowEmergency?: boolean },
): typeof candidates {
  const allowAtMax = options?.allowAtMax ?? false;
  const allowEmergency = options?.allowEmergency ?? false;

  return [...candidates]
    .filter((c) => {
      if (allowAtMax || allowEmergency) return true;
      return isBelowMaxTurns(ctx, c.uuid);
    })
    .sort((a, b) => {
      const belowMinA = isBelowMinTurns(ctx, a.uuid) ? 0 : 1;
      const belowMinB = isBelowMinTurns(ctx, b.uuid) ? 0 : 1;
      if (belowMinA !== belowMinB) return belowMinA - belowMinB;

      const targetDefA = targetTurnDeficit(ctx, a.uuid);
      const targetDefB = targetTurnDeficit(ctx, b.uuid);
      if (targetDefA !== targetDefB) return targetDefB - targetDefA;

      const prefA = preferenceScoreForShift(ws, ctx, a.uuid, shift);
      const prefB = preferenceScoreForShift(ws, ctx, b.uuid, shift);
      if (prefA !== prefB) return prefB - prefA;

      const curA = currentTurnCount(ctx, a.uuid);
      const curB = currentTurnCount(ctx, b.uuid);
      if (curA !== curB) return curA - curB;

      if (a.seniority !== b.seniority) return a.seniority - b.seniority;
      const rankCmp = comparePaoPoolRank(ctx.paoPoolSeniorityByEmployee, a.uuid, b.uuid);
      if (rankCmp !== 0) return rankCmp;
      return a.uuid.localeCompare(b.uuid);
    });
}

export function logRateioOverflow(
  ctx: ScheduleRateioContext,
  employeeId: string,
  shift: ShiftCode,
  day: string,
): void {
  ctx.overflowEvents.push(
    `RATEIO_TURNOS_OVERFLOW_EMERGENCIAL:${employeeId}:${shift}:${day}`,
  );
}
