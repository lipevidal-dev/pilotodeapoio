import { addDays } from "../../rules/dates.js";
import { normalizeOperationalLabel } from "../operational-labels.js";
import { assignmentKey } from "../types.js";
import {
  BLOCK_MAX_SIZE,
  BLOCK_MIN_SIZE,
} from "./demand-planning-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Bf — tamanho ideal do bloco: 4 se Yf ≤ 12, senão 5. */
export function idealBlockSizeForTarget(yf: number): number {
  if (yf <= 0) return BLOCK_MIN_SIZE;
  return yf <= 12 ? 4 : 5;
}

/** Zf — quantidade de blocos: ceil(Yf / Bf). */
export function plannedBlockCountForTarget(yf: number): number {
  if (yf <= 0) return 0;
  return Math.ceil(yf / idealBlockSizeForTarget(yf));
}

/** Xf — distância ideal entre blocos. */
export function idealBlockSpacing(diasDisponiveis: number, zf: number): number {
  if (zf <= 0) return diasDisponiveis;
  return diasDisponiveis / zf;
}

/** Penalidade de qualidade por tamanho de bloco (Motor V3). */
export function scoreBlockQuality(size: number, yf: number): number {
  if (size === 1) return 100;
  if (size === 2) return 50;
  const bf = idealBlockSizeForTarget(yf);
  return Math.abs(size - bf) * 10;
}

/**
 * Dias em que o funcionário pode receber novos turnos T6/T7.
 * Exclui férias, FP, FANI, folgas, T8/ND e pré-alocações ocupadas.
 */
export function listEmployeeAvailableDays(ws: GenerationWorkspace, uuid: string): string[] {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return [];

  return ws.days.filter((day) => {
    if (ws.isLockedByAdmin(uuid, day)) return false;
    if (ws.planned.has(assignmentKey(did, day))) return false;
    if (ws.isDayBlockedForShift(uuid, day)) return false;
    return true;
  });
}

export function countEmployeeAvailableDays(ws: GenerationWorkspace, uuid: string): number {
  return listEmployeeAvailableDays(ws, uuid).length;
}

function canPlaceWorkDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  if (ws.isDayBlockedForShift(uuid, day)) return false;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  return !ws.planned.has(assignmentKey(did, day));
}

function rebalanceWeakBlocks(blocks: number[], yf: number): number[] {
  const out = [...blocks];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      if (out[i]! > 2) continue;
      if (i > 0 && out[i - 1]! + out[i]! <= BLOCK_MAX_SIZE) {
        out[i - 1]! += out[i]!;
        out.splice(i, 1);
        changed = true;
        break;
      }
      if (i + 1 < out.length && out[i]! + out[i + 1]! <= BLOCK_MAX_SIZE) {
        out[i]! += out[i + 1]!;
        out.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }

  const sum = out.reduce((a, b) => a + b, 0);
  if (sum !== yf && out.length > 0) {
    const delta = yf - sum;
    const last = out.length - 1;
    const next = out[last]! + delta;
    if (next >= BLOCK_MIN_SIZE && next <= BLOCK_MAX_SIZE) {
      out[last] = next;
    }
  }

  return out.filter((size) => size > 0);
}

/** Etapa 3–4 V3 — decompõe Yf em Zf blocos preferindo Bf (3–5 dias). */
export function targetToBlocksV3(yf: number): number[] {
  if (yf <= 0) return [];
  if (yf <= 2) return [yf];

  const zf = plannedBlockCountForTarget(yf);

  if (zf === 1) {
    return [Math.min(Math.max(yf, BLOCK_MIN_SIZE), BLOCK_MAX_SIZE)];
  }

  const blocks: number[] = [];
  let rem = yf;

  for (let i = 0; i < zf; i++) {
    const remaining = zf - i;
    let size =
      i === zf - 1
        ? rem
        : Math.max(BLOCK_MIN_SIZE, Math.min(BLOCK_MAX_SIZE, Math.ceil(rem / remaining)));
    size = Math.max(1, Math.min(BLOCK_MAX_SIZE, size));
    blocks.push(size);
    rem -= size;
  }

  return rebalanceWeakBlocks(blocks, yf);
}

function anchorDayIndex(
  ws: GenerationWorkspace,
  availableDays: string[],
  blockIndex: number,
  xf: number,
): number {
  if (availableDays.length === 0) return 0;
  const slotIdx = Math.min(
    availableDays.length - 1,
    Math.max(0, Math.round((blockIndex + 0.5) * xf - xf / 2)),
  );
  const anchorDay = availableDays[slotIdx] ?? availableDays[0]!;
  const calendarIdx = ws.days.indexOf(anchorDay);
  return calendarIdx >= 0 ? calendarIdx : 0;
}

function searchIndices(center: number, maxStart: number): number[] {
  const order: number[] = [];
  order.push(center);
  for (let delta = 1; delta <= maxStart + 1; delta++) {
    if (center - delta >= 0) order.push(center - delta);
    if (center + delta <= maxStart) order.push(center + delta);
  }
  return order;
}

/** Etapa 6 V3 — posiciona bloco próximo ao espaçamento ideal Xf. */
export function findSpacedConsecutiveSlot(
  ws: GenerationWorkspace,
  uuid: string,
  size: number,
  blockIndex: number,
  totalBlocks: number,
  initialAvailableDays: string[],
  preferredStarts?: readonly string[],
): string | null {
  if (size <= 0) return null;

  const diasDisponiveis = initialAvailableDays.length;
  const xf = idealBlockSpacing(diasDisponiveis, totalBlocks);
  const idealStart = anchorDayIndex(ws, initialAvailableDays, blockIndex, xf);
  const maxStart = Math.max(0, ws.days.length - size);

  const candidates: Array<{ start: string; dist: number; order: number }> = [];
  for (const di of searchIndices(idealStart, maxStart)) {
    if (di < 0 || di > maxStart) continue;
    const start = ws.days[di]!;
    let ok = true;
    for (let j = 0; j < size; j++) {
      if (!canPlaceWorkDay(ws, uuid, ws.days[di + j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      candidates.push({
        start,
        dist: Math.abs(di - idealStart),
        order: di,
      });
    }
  }

  if (candidates.length === 0) {
    for (let di = 0; di <= maxStart; di++) {
      const start = ws.days[di]!;
      let ok = true;
      for (let j = 0; j < size; j++) {
        if (!canPlaceWorkDay(ws, uuid, ws.days[di + j]!)) {
          ok = false;
          break;
        }
      }
      if (ok) candidates.push({ start, dist: Number.MAX_SAFE_INTEGER, order: di });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const prefA = preferredStarts?.includes(a.start) ? 0 : 1;
    const prefB = preferredStarts?.includes(b.start) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;
    return a.dist - b.dist || a.order - b.order || a.start.localeCompare(b.start);
  });
  return candidates[0]!.start;
}

/** Verifica se label de pré-alocação conta como trabalho no bloco V3. */
export function isV3WorkPreAllocation(label: string): boolean {
  const n = normalizeOperationalLabel(label).toUpperCase();
  return (
    n === "VOO" ||
    n === "SIMULADOR" ||
    n === "CURSO" ||
    n === "CURSO ONLINE" ||
    n === "CMA" ||
    n === "OUTRO"
  );
}

/** Dia trabalhado para composição de bloco (inclui T9 via turno). */
export function isV3BlockWorkShift(code: string): boolean {
  const upper = code.toUpperCase();
  return upper === "T6" || upper === "T7" || upper === "T8" || upper === "T9";
}

/** T8/T8/ND é bloco indivisível de 3 dias. */
export function isT8NdBlockDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const code = ws.planned.get(assignmentKey(did, day));
  if (code === "T8") return true;
  return ws.allocations.some(
    (a) =>
      a.employeeUuid === uuid &&
      a.date === day &&
      normalizeOperationalLabel(a.label).toUpperCase() === "ND",
  );
}

export function consecutiveRunLength(days: string[]): number {
  if (days.length === 0) return 0;
  let max = 1;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (addDays(days[i - 1]!, 1) === days[i]) {
      streak++;
      max = Math.max(max, streak);
    } else {
      streak = 1;
    }
  }
  return max;
}
