import { validateSchedule } from "../rules/engine.js";
import { addDays } from "../rules/dates.js";
import { assignmentKey } from "./types.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GeneratedAllocation } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

const MOVABLE_SHIFT_CODES = new Set(["T6", "T7"]);

const WORK_ALLOC_LABELS = new Set([
  "ND",
  "VOO",
  "SIMULADOR",
  "CURSO",
  "CURSO ONLINE",
  "CMA",
  "OUTRO",
]);

export interface WorkBlock {
  startDay: string;
  endDay: string;
  size: number;
  days: string[];
}

export interface BlockOptimizerMetrics {
  turnosIsolados: number;
  blocosDe2: number;
  tamanhoMedioBlocos: number;
  desvioPadraoBlocos: number;
  espacamentoMedioBlocos: number;
  blockOptimizerScore: number;
}

export interface BlockOptimizerAction {
  kind: "shift_moved" | "shift_swapped";
  employee: string;
  detail: string;
}

export interface BlockOptimizerReport {
  iterations: number;
  initialScore: number;
  finalScore: number;
  improved: boolean;
  actionsCount: number;
  metrics: BlockOptimizerMetrics;
  initialMetrics: BlockOptimizerMetrics;
  actions: BlockOptimizerAction[];
}

interface WorkspaceSnapshot {
  planned: Map<string, string>;
  blocked: Map<string, string>;
  allocations: GeneratedAllocation[];
}

type MoveCandidate =
  | { type: "move"; uuid: string; fromDay: string; toDay: string }
  | { type: "swap"; uuidA: string; dayA: string; uuidB: string; dayB: string };

export function computeBlocoIdeal(metaDiasTrabalhados: number): number {
  if (metaDiasTrabalhados <= 12) return 3;
  if (metaDiasTrabalhados <= 18) return 4;
  if (metaDiasTrabalhados <= 25) return 5;
  return 6;
}

export function isBlockWorkDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did != null && ws.planned.has(assignmentKey(did, day))) {
    return true;
  }
  for (const al of ws.allocations) {
    if (al.employeeUuid !== uuid || al.date !== day) continue;
    const n = normalizeOperationalLabel(al.label).toUpperCase();
    if (WORK_ALLOC_LABELS.has(n)) return true;
  }
  return false;
}

export function findWorkBlocks(ws: GenerationWorkspace, uuid: string): WorkBlock[] {
  const blocks: WorkBlock[] = [];
  let current: string[] = [];

  for (const day of ws.days) {
    if (isBlockWorkDay(ws, uuid, day)) {
      current.push(day);
      continue;
    }
    if (current.length > 0) {
      blocks.push({
        startDay: current[0]!,
        endDay: current[current.length - 1]!,
        size: current.length,
        days: [...current],
      });
      current = [];
    }
  }

  if (current.length > 0) {
    blocks.push({
      startDay: current[0]!,
      endDay: current[current.length - 1]!,
      size: current.length,
      days: [...current],
    });
  }

  return blocks;
}

export function scoreBlockSize(size: number, blocoIdeal: number): number {
  if (size === 1) return 100;
  if (size === 2) return 50;
  if (size === blocoIdeal) return 0;
  return Math.abs(size - blocoIdeal) * 10;
}

function blockSpacings(blocks: WorkBlock[]): number[] {
  const spacings: number[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1]!.endDay;
    const next = blocks[i]!.startDay;
    let gap = 0;
    let cursor = addDays(prev, 1);
    while (cursor < next) {
      gap++;
      cursor = addDays(cursor, 1);
    }
    spacings.push(gap);
  }
  return spacings;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function scoreEmployeeBlocks(
  ws: GenerationWorkspace,
  uuid: string,
  daysInMonth: number,
): { score: number; blocks: WorkBlock[]; blocoIdeal: number } {
  const blocks = findWorkBlocks(ws, uuid);
  const metaDias = blocks.reduce((sum, b) => sum + b.size, 0);
  const blocoIdeal = computeBlocoIdeal(metaDias);

  let score = 0;
  for (const block of blocks) {
    score += scoreBlockSize(block.size, blocoIdeal);
  }

  const idealSpacing = blocks.length > 0 ? daysInMonth / blocks.length : daysInMonth;
  for (const spacing of blockSpacings(blocks)) {
    score += Math.abs(spacing - idealSpacing) * 5;
  }

  return { score, blocks, blocoIdeal };
}

export function computeBlockOptimizerMetrics(ws: GenerationWorkspace): BlockOptimizerMetrics {
  const daysInMonth = ws.days.length;
  let turnosIsolados = 0;
  let blocosDe2 = 0;
  const allSizes: number[] = [];
  const allSpacings: number[] = [];
  let blockOptimizerScore = 0;

  for (const emp of ws.paoEmps) {
    const { score, blocks } = scoreEmployeeBlocks(ws, emp.uuid, daysInMonth);
    blockOptimizerScore += score;
    for (const block of blocks) {
      allSizes.push(block.size);
      if (block.size === 1) turnosIsolados++;
      if (block.size === 2) blocosDe2++;
    }
    allSpacings.push(...blockSpacings(blocks));
  }

  const tamanhoMedioBlocos =
    allSizes.length > 0 ? allSizes.reduce((a, b) => a + b, 0) / allSizes.length : 0;
  const espacamentoMedioBlocos =
    allSpacings.length > 0 ? allSpacings.reduce((a, b) => a + b, 0) / allSpacings.length : 0;

  return {
    turnosIsolados,
    blocosDe2,
    tamanhoMedioBlocos: Math.round(tamanhoMedioBlocos * 100) / 100,
    desvioPadraoBlocos: Math.round(stdDev(allSizes) * 100) / 100,
    espacamentoMedioBlocos: Math.round(espacamentoMedioBlocos * 100) / 100,
    blockOptimizerScore: Math.round(blockOptimizerScore * 100) / 100,
  };
}

function captureSnapshot(ws: GenerationWorkspace): WorkspaceSnapshot {
  return {
    planned: new Map(ws.planned),
    blocked: new Map(ws.blocked),
    allocations: ws.allocations.map((a) => ({ ...a })),
  };
}

function restoreSnapshot(ws: GenerationWorkspace, snap: WorkspaceSnapshot): void {
  ws.planned.clear();
  for (const [key, value] of snap.planned) {
    ws.planned.set(key, value);
  }
  ws.blocked.clear();
  for (const [key, value] of snap.blocked) {
    ws.blocked.set(key, value);
  }
  ws.allocations.length = 0;
  ws.allocations.push(...snap.allocations.map((a) => ({ ...a })));
  ws.coverageGapsCache = null;
}

function getMovableShift(ws: GenerationWorkspace, uuid: string, day: string): string | null {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return null;
  if (ws.isLockedByAdmin(uuid, day)) return null;
  if (ws.isT8BlockProtected(uuid, day)) return null;
  const code = ws.planned.get(assignmentKey(did, day));
  if (!code || !MOVABLE_SHIFT_CODES.has(code)) return null;
  return code;
}

function isMoveValid(ws: GenerationWorkspace): boolean {
  if (ws.listCoverageGaps().length > 0) return false;
  ws.ensureNdForT8Pairs();
  ws.revalidateCoverageAfterBalance();
  const issues = validateSchedule(ws.toScheduleContext());
  return !issues.some((issue) => issue.level === "CRITICAL" || issue.severity === "ALTA");
}

function tryMoveShift(
  ws: GenerationWorkspace,
  uuid: string,
  fromDay: string,
  toDay: string,
): boolean {
  if (fromDay === toDay || !ws.days.includes(toDay)) return false;
  if (!ws.isPaoDayEmpty(uuid, toDay)) return false;
  if (ws.isLockedByAdmin(uuid, toDay)) return false;

  const code = getMovableShift(ws, uuid, fromDay);
  if (!code) return false;

  if (!ws.tryRemoveShiftPreservingCoverage(uuid, fromDay)) return false;
  if (!ws.tryAssignShift(uuid, toDay, code)) return false;
  return isMoveValid(ws);
}

function trySwapShifts(
  ws: GenerationWorkspace,
  uuidA: string,
  dayA: string,
  uuidB: string,
  dayB: string,
): boolean {
  const codeA = getMovableShift(ws, uuidA, dayA);
  const codeB = getMovableShift(ws, uuidB, dayB);
  if (!codeA || !codeB || codeA !== codeB) return false;

  if (!ws.tryRemoveShiftPreservingCoverage(uuidA, dayA)) return false;
  if (!ws.tryRemoveShiftPreservingCoverage(uuidB, dayB)) return false;
  if (!ws.tryAssignShift(uuidA, dayB, codeA)) return false;
  if (!ws.tryAssignShift(uuidB, dayA, codeB)) return false;
  return isMoveValid(ws);
}

function employeeName(ws: GenerationWorkspace, uuid: string): string {
  return ws.input.employees.find((e) => e.uuid === uuid)?.employee.name ?? uuid;
}

function applyCandidate(ws: GenerationWorkspace, candidate: MoveCandidate): boolean {
  if (candidate.type === "move") {
    return tryMoveShift(ws, candidate.uuid, candidate.fromDay, candidate.toDay);
  }
  return trySwapShifts(ws, candidate.uuidA, candidate.dayA, candidate.uuidB, candidate.dayB);
}

function describeCandidate(ws: GenerationWorkspace, candidate: MoveCandidate): string {
  if (candidate.type === "move") {
    const code = getMovableShift(ws, candidate.uuid, candidate.fromDay) ?? "?";
    return `${code} ${candidate.fromDay} → ${candidate.toDay}`;
  }
  const code = getMovableShift(ws, candidate.uuidA, candidate.dayA) ?? "?";
  return `${employeeName(ws, candidate.uuidA)}@${candidate.dayA} ↔ ${employeeName(ws, candidate.uuidB)}@${candidate.dayB} (${code})`;
}

function emptyBridgeDays(ws: GenerationWorkspace, uuid: string, left: WorkBlock, right: WorkBlock): string[] {
  const out: string[] = [];
  let cursor = addDays(left.endDay, 1);
  while (cursor < right.startDay) {
    if (ws.isPaoDayEmpty(uuid, cursor)) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function generateCandidates(ws: GenerationWorkspace): MoveCandidate[] {
  const candidates: MoveCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: MoveCandidate) => {
    const key =
      candidate.type === "move"
        ? `move|${candidate.uuid}|${candidate.fromDay}|${candidate.toDay}`
        : `swap|${candidate.uuidA}|${candidate.dayA}|${candidate.uuidB}|${candidate.dayB}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const emp of ws.paoEmps) {
    const uuid = emp.uuid;
    const blocks = findWorkBlocks(ws, uuid);
    const weakBlocks = blocks.filter((block) => block.size <= 2);

    for (const block of weakBlocks) {
      for (const day of block.days) {
        if (!getMovableShift(ws, uuid, day)) continue;

        for (const offset of [-1, 1, -2, 2, -3, 3]) {
          const toDay = addDays(day, offset);
          if (!ws.days.includes(toDay)) continue;
          if (!ws.isPaoDayEmpty(uuid, toDay)) continue;
          pushCandidate({ type: "move", uuid, fromDay: day, toDay });
        }

        for (const other of blocks) {
          if (other === block) continue;
          for (const bridgeDay of emptyBridgeDays(ws, uuid, other, block)) {
            pushCandidate({ type: "move", uuid, fromDay: day, toDay: bridgeDay });
          }
          for (const bridgeDay of emptyBridgeDays(ws, uuid, block, other)) {
            pushCandidate({ type: "move", uuid, fromDay: day, toDay: bridgeDay });
          }
        }
      }
    }
  }

  for (let i = 0; i < ws.paoEmps.length; i++) {
    for (let j = i + 1; j < ws.paoEmps.length; j++) {
      const uuidA = ws.paoEmps[i]!.uuid;
      const uuidB = ws.paoEmps[j]!.uuid;
      for (const dayA of ws.days) {
        const codeA = getMovableShift(ws, uuidA, dayA);
        if (!codeA) continue;
        for (const dayB of ws.days) {
          if (dayA === dayB) continue;
          if (getMovableShift(ws, uuidB, dayB) !== codeA) continue;
          pushCandidate({ type: "swap", uuidA, dayA, uuidB, dayB });
        }
      }
    }
  }

  return candidates;
}

const MAX_ITERATIONS = 1000;

export class BlockOptimizer {
  optimize(ws: GenerationWorkspace): BlockOptimizerReport {
    const initialMetrics = computeBlockOptimizerMetrics(ws);
    const initialScore = initialMetrics.blockOptimizerScore;
    let currentScore = initialScore;
    const actions: BlockOptimizerAction[] = [];
    let iterations = 0;

    for (iterations = 0; iterations < MAX_ITERATIONS; iterations++) {
      const candidates = generateCandidates(ws);
      let bestCandidate: MoveCandidate | null = null;
      let bestScore = currentScore;

      for (const candidate of candidates) {
        const snap = captureSnapshot(ws);
        if (!applyCandidate(ws, candidate)) continue;

        const score = computeBlockOptimizerMetrics(ws).blockOptimizerScore;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
        restoreSnapshot(ws, snap);
      }

      if (!bestCandidate || bestScore >= currentScore) break;

      applyCandidate(ws, bestCandidate);
      currentScore = bestScore;

      const primaryUuid =
        bestCandidate.type === "move" ? bestCandidate.uuid : bestCandidate.uuidA;
      actions.push({
        kind: bestCandidate.type === "move" ? "shift_moved" : "shift_swapped",
        employee: employeeName(ws, primaryUuid),
        detail: describeCandidate(ws, bestCandidate),
      });
    }

    const finalMetrics = computeBlockOptimizerMetrics(ws);

    return {
      iterations,
      initialScore,
      finalScore: currentScore,
      improved: currentScore < initialScore,
      actionsCount: actions.length,
      metrics: finalMetrics,
      initialMetrics,
      actions,
    };
  }
}

export const blockOptimizer = new BlockOptimizer();
