import { addDays } from "../rules/dates.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import type { ValidationIssue } from "./types.js";
import { assignmentKey } from "./types.js";
import {
  captureOptimizationSnapshot,
  restoreOptimizationSnapshot,
} from "./workspace-optimization-transaction.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import { finalizeT8NdBlocks } from "./schedule-grid-source.js";
import { normalizeOperationalLabel } from "./operational-labels.js";

export const V58_MIN_WORK_BLOCK_SIZE = 3;
export const V58_MAX_WORK_BLOCK_SIZE = 5;

export interface V58WorkBlock {
  employeeUuid: string;
  employeeName: string;
  startDay: string;
  endDay: string;
  size: number;
  /** Tamanho efetivo — T8/T8+ND conta como 3. */
  effectiveSize?: number;
  days: string[];
}

export interface V58WorkBlockAuditEntry {
  employeeUuid: string;
  name: string;
  date: string;
  shift: string;
  blockBefore: string;
  blockAfter: string;
  action: string;
  result: "OK" | "FAIL" | "BLOCKED" | "CRITICAL";
  reason: string;
}

export interface V58RepairReport {
  invalidBefore: number;
  invalidAfter: number;
  fixed: number;
  criticalRemaining: number;
}

export interface UnassignV58WorkBlockOpts {
  bypassV58WorkBlock?: boolean;
}

export function clearV58WorkBlockAudit(ws: GenerationWorkspace): void {
  ws.v58WorkBlockAudit.length = 0;
}

export function isV58WorkShift(code: string | undefined): boolean {
  if (!code) return false;
  return isRateioTurnShiftCode(code);
}

function shiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return undefined;
  return ws.planned.get(assignmentKey(did, day));
}

/** Dia conta como trabalhado V5.8 somente com T6/T7/T8/T9. */
export function isV58WorkDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  return isV58WorkShift(shiftOnDay(ws, uuid, day));
}

function collectWorkDays(
  ws: GenerationWorkspace,
  uuid: string,
  add?: { day: string; shift: string },
  remove?: string,
): Set<string> {
  const days = new Set<string>();
  for (const day of ws.days) {
    if (remove === day) continue;
    if (isV58WorkDay(ws, uuid, day)) days.add(day);
  }
  if (add && isV58WorkShift(add.shift)) {
    days.add(add.day);
  }
  return days;
}

export function findV58WorkBlocksForEmployee(
  ws: GenerationWorkspace,
  uuid: string,
  add?: { day: string; shift: string },
  remove?: string,
): Omit<V58WorkBlock, "employeeUuid" | "employeeName">[] {
  const workDays = collectWorkDays(ws, uuid, add, remove);
  const blocks: Omit<V58WorkBlock, "employeeUuid" | "employeeName">[] = [];
  let current: string[] = [];

  for (const day of ws.days) {
    if (workDays.has(day)) {
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

export function listInvalidV58WorkBlocks(ws: GenerationWorkspace): V58WorkBlock[] {
  const out: V58WorkBlock[] = [];
  for (const c of ws.paoEmps) {
    for (const block of findV58WorkBlocksForEmployee(ws, c.uuid)) {
      const effectiveSize = effectiveV58BlockSize(ws, c.uuid, block);
      if (effectiveSize < V58_MIN_WORK_BLOCK_SIZE) {
        out.push({
          employeeUuid: c.uuid,
          employeeName: c.employee.name,
          ...block,
          effectiveSize,
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      ws.days.indexOf(a.startDay) - ws.days.indexOf(b.startDay) ||
      a.employeeName.localeCompare(b.employeeName, "pt-BR"),
  );
}

function hasNdClosureAfterT8Pair(ws: GenerationWorkspace, uuid: string, secondT8Day: string): boolean {
  const ndDay = addDays(secondT8Day, 1);
  if (!ws.days.includes(ndDay)) return true;

  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;

  return (
    ws.allocations.some(
      (a) =>
        a.employeeUuid === uuid &&
        a.date === ndDay &&
        normalizeOperationalLabel(a.label).toUpperCase() === "ND",
    ) || ws.blocked.get(assignmentKey(did, ndDay)) === "ND"
  );
}

/** T8/T8 seguido de ND (ou ND fora do mês) satisfaz mínimo de 3 dias de bloco. */
export function effectiveV58BlockSize(
  ws: GenerationWorkspace,
  uuid: string,
  block: { size: number; days: string[] },
): number {
  if (block.size >= V58_MIN_WORK_BLOCK_SIZE) return block.size;

  if (block.size === 2) {
    const shifts = block.days.map((d) => shiftOnDay(ws, uuid, d)?.toUpperCase());
    if (shifts.every((s) => s === "T8")) {
      const lastDay = block.days[block.days.length - 1]!;
      if (hasNdClosureAfterT8Pair(ws, uuid, lastDay)) return V58_MIN_WORK_BLOCK_SIZE;
    }
  }

  return block.size;
}

function isInvalidV58Block(
  ws: GenerationWorkspace,
  uuid: string,
  block: { size: number; days: string[] },
): boolean {
  return effectiveV58BlockSize(ws, uuid, block) < V58_MIN_WORK_BLOCK_SIZE;
}

function formatBlockLabel(
  block: { size: number; effectiveSize?: number; startDay: string; endDay: string } | undefined,
): string {
  if (!block) return "-";
  const eff = block.effectiveSize ?? block.size;
  return `${eff}d (${block.startDay}..${block.endDay})`;
}

function findBlockContaining(
  blocks: Array<{ size: number; startDay: string; endDay: string; days: string[] }>,
  day: string,
): { size: number; startDay: string; endDay: string; days: string[] } | undefined {
  return blocks.find((b) => b.days.includes(day));
}

function hasInvalidV58Blocks(
  ws: GenerationWorkspace,
  uuid: string,
  add?: { day: string; shift: string },
  remove?: string,
): boolean {
  const blocks = findV58WorkBlocksForEmployee(ws, uuid, add, remove);
  return blocks.some((b) => isInvalidV58Block(ws, uuid, b));
}

/** Simula assign/unassign e detecta bloco inválido (1–2 dias consecutivos). */
export function wouldCreateIsolatedWorkBlock(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shift: string,
  mode: "assign" | "unassign" = "assign",
): boolean {
  if (mode === "assign") {
    if (!isV58WorkShift(shift)) return false;
    return hasInvalidV58Blocks(ws, uuid, { day, shift });
  }

  const current = shiftOnDay(ws, uuid, day);
  if (!isV58WorkShift(current)) return false;
  return hasInvalidV58Blocks(ws, uuid, undefined, day);
}

export function canAssignV58WorkBlock(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shift: string,
): boolean {
  if (!ws.v58WorkBlockGuardEnabled) return true;
  if (!wouldCreateIsolatedWorkBlock(ws, uuid, day, shift, "assign")) return true;
  logV58WorkBlock(ws, {
    employeeUuid: uuid,
    date: day,
    shift,
    blockBefore: formatBlockLabel(findBlockContaining(findV58WorkBlocksForEmployee(ws, uuid), day)),
    blockAfter: formatBlockLabel(
      findBlockContaining(findV58WorkBlocksForEmployee(ws, uuid, { day, shift }), day),
    ),
    action: "tryAssignShift",
    result: "BLOCKED",
    reason: "criaria bloco de turno < 3 dias",
  });
  return false;
}

export function canUnassignV58WorkBlock(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  shiftCode: string,
  opts?: UnassignV58WorkBlockOpts,
): boolean {
  if (opts?.bypassV58WorkBlock) return true;
  if (!ws.v58WorkBlockGuardEnabled) return true;
  if (!wouldCreateIsolatedWorkBlock(ws, uuid, day, shiftCode, "unassign")) return true;
  logV58WorkBlock(ws, {
    employeeUuid: uuid,
    date: day,
    shift: shiftCode,
    blockBefore: formatBlockLabel(findBlockContaining(findV58WorkBlocksForEmployee(ws, uuid), day)),
    blockAfter: formatBlockLabel(
      findBlockContaining(findV58WorkBlocksForEmployee(ws, uuid, undefined, day), day),
    ),
    action: "unassignShift",
    result: "BLOCKED",
    reason: "deixaria bloco de turno < 3 dias",
  });
  return false;
}

export function canTransferV58WorkBlock(
  ws: GenerationWorkspace,
  donorUuid: string,
  receiverUuid: string,
  day: string,
  shift: string,
): boolean {
  if (!ws.v58WorkBlockGuardEnabled) return true;
  if (
    wouldCreateIsolatedWorkBlock(ws, donorUuid, day, shift, "unassign") ||
    wouldCreateIsolatedWorkBlock(ws, receiverUuid, day, shift, "assign")
  ) {
    logV58WorkBlock(ws, {
      employeeUuid: receiverUuid,
      date: day,
      shift,
      blockBefore: "-",
      blockAfter: "-",
      action: "transferShift",
      result: "BLOCKED",
      reason: "transferência criaria bloco inválido",
    });
    return false;
  }
  return true;
}

export function logV58WorkBlock(
  ws: GenerationWorkspace,
  entry: Omit<V58WorkBlockAuditEntry, "name"> & { name?: string },
): void {
  const emp = ws.input.employees.find((e) => e.uuid === entry.employeeUuid);
  ws.v58WorkBlockAudit.push({
    name: entry.name ?? emp?.employee.name ?? entry.employeeUuid,
    ...entry,
  });
}

function dominantShiftInBlock(ws: GenerationWorkspace, uuid: string, days: string[]): string {
  const counts = new Map<string, number>();
  for (const day of days) {
    const code = shiftOnDay(ws, uuid, day)?.toUpperCase();
    if (!code || !isV58WorkShift(code)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best = "T6";
  let bestCount = -1;
  for (const [code, n] of counts) {
    if (n > bestCount) {
      best = code;
      bestCount = n;
    }
  }
  return best;
}

function tryExpandBlock(
  ws: GenerationWorkspace,
  block: V58WorkBlock,
): boolean {
  const shift = dominantShiftInBlock(ws, block.employeeUuid, block.days);
  const baseline = captureOptimizationSnapshot(ws);
  const guardWas = ws.v58WorkBlockGuardEnabled;
  ws.v58WorkBlockGuardEnabled = false;

  let placed = 0;
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const blocks = findV58WorkBlocksForEmployee(ws, block.employeeUuid);
      const current =
        blocks.find((b) => b.startDay === block.startDay) ??
        blocks.find((b) => b.days.some((d) => block.days.includes(d)));
      if (!current || !isInvalidV58Block(ws, block.employeeUuid, current)) break;

      const before = addDays(current.startDay, -1);
      const after = addDays(current.endDay, 1);
      let expanded = false;

      for (const day of [before, after]) {
        if (!ws.days.includes(day)) continue;
        if (!ws.isPaoDayEmpty(block.employeeUuid, day)) continue;
        if (ws.isDayBlockedForShift(block.employeeUuid, day)) continue;
        if (shift === "T6" || shift === "T7") {
          if (wouldExceedT6T7BlockMax(ws, block.employeeUuid, day, shift as "T6" | "T7")) continue;
        }
        if (shift === "T8") {
          if (ws.tryPlaceT8Block(block.employeeUuid, day, true)) {
            placed++;
            finalizeT8NdBlocks(ws);
            expanded = true;
            break;
          }
          continue;
        }
        if (ws.tryAssignShift(block.employeeUuid, day, shift, true)) {
          placed++;
          expanded = true;
          break;
        }
      }
      if (!expanded) break;
    }
  } finally {
    ws.v58WorkBlockGuardEnabled = guardWas;
  }

  const invalidAfter = listInvalidV58WorkBlocks(ws).filter((b) => b.employeeUuid === block.employeeUuid);
  if (invalidAfter.length === 0) {
    logV58WorkBlock(ws, {
      employeeUuid: block.employeeUuid,
      date: block.startDay,
      shift,
      blockBefore: formatBlockLabel(block),
      blockAfter: formatBlockLabel(findBlockContaining(findV58WorkBlocksForEmployee(ws, block.employeeUuid), block.startDay)),
      action: "expand_block",
      result: "OK",
      reason: `+${placed} dia(s)`,
    });
    return true;
  }

  restoreOptimizationSnapshot(ws, baseline);
  return false;
}

function tryBridgeBlocks(
  ws: GenerationWorkspace,
  uuid: string,
): boolean {
  const blocks = findV58WorkBlocksForEmployee(ws, uuid);
  if (blocks.length < 2) return false;

  for (let i = 0; i < blocks.length - 1; i++) {
    const left = blocks[i]!;
    const right = blocks[i + 1]!;
    const gapStart = addDays(left.endDay, 1);
    const gapEnd = addDays(right.startDay, -1);
    if (gapStart > gapEnd) continue;

    const shift = dominantShiftInBlock(ws, uuid, [...left.days, ...right.days]);
    const baseline = captureOptimizationSnapshot(ws);
    const guardWas = ws.v58WorkBlockGuardEnabled;
    ws.v58WorkBlockGuardEnabled = false;
    let bridged = true;

    try {
      for (const day of ws.days) {
        if (day < gapStart || day > gapEnd) continue;
        if (!ws.isPaoDayEmpty(uuid, day)) {
          bridged = false;
          break;
        }
        if (shift === "T6" || shift === "T7") {
          if (wouldExceedT6T7BlockMax(ws, uuid, day, shift as "T6" | "T7")) {
            bridged = false;
            break;
          }
        }
        if (!ws.tryAssignShift(uuid, day, shift, true)) {
          bridged = false;
          break;
        }
      }
    } finally {
      ws.v58WorkBlockGuardEnabled = guardWas;
    }

    if (bridged && !hasInvalidV58Blocks(ws, uuid)) {
      logV58WorkBlock(ws, {
        employeeUuid: uuid,
        date: left.endDay,
        shift,
        blockBefore: `${left.size}d+${right.size}d`,
        blockAfter: formatBlockLabel(findBlockContaining(findV58WorkBlocksForEmployee(ws, uuid), left.startDay)),
        action: "bridge_blocks",
        result: "OK",
        reason: "preencheu lacuna entre blocos",
      });
      return true;
    }
    restoreOptimizationSnapshot(ws, baseline);
  }
  return false;
}

/** Repara blocos inválidos — expandir, anexar (mutação conservadora com rollback). */
export function repairIsolatedWorkBlocks(
  ws: GenerationWorkspace,
  _ctx: ScheduleRateioContext,
): V58RepairReport {
  const invalidBefore = listInvalidV58WorkBlocks(ws).length;
  if (invalidBefore === 0) {
    return { invalidBefore: 0, invalidAfter: 0, fixed: 0, criticalRemaining: 0 };
  }

  const baseline = captureOptimizationSnapshot(ws);
  const gapsBefore = ws.listCoverageGaps().length;
  let fixed = 0;

  for (let pass = 0; pass < 6; pass++) {
    const invalid = listInvalidV58WorkBlocks(ws);
    if (invalid.length === 0) break;

    let progress = false;
    for (const block of invalid) {
      if (tryExpandBlock(ws, block)) {
        fixed++;
        progress = true;
        continue;
      }
      if (tryBridgeBlocks(ws, block.employeeUuid)) {
        fixed++;
        progress = true;
      }
    }

    if (!progress) break;
  }

  if (ws.listCoverageGaps().length > gapsBefore) {
    restoreOptimizationSnapshot(ws, baseline);
    clearV58WorkBlockAudit(ws);
    return {
      invalidBefore,
      invalidAfter: invalidBefore,
      fixed: 0,
      criticalRemaining: invalidBefore,
    };
  }

  const remaining = listInvalidV58WorkBlocks(ws);
  for (const block of remaining) {
    logV58WorkBlock(ws, {
      employeeUuid: block.employeeUuid,
      date: block.startDay,
      shift: dominantShiftInBlock(ws, block.employeeUuid, block.days),
      blockBefore: formatBlockLabel(block),
      blockAfter: formatBlockLabel(block),
      action: "repair_exhausted",
      result: "CRITICAL",
      reason: "bloco inválido persistente",
    });
  }

  return {
    invalidBefore,
    invalidAfter: remaining.length,
    fixed,
    criticalRemaining: remaining.length,
  };
}

export function validateNoIsolatedWorkShifts(ws: GenerationWorkspace): ValidationIssue[] {
  return listInvalidV58WorkBlocks(ws).map((block) => ({
    severity: "CRÍTICA",
    level: "CRITICAL",
    type: "V58_ISOLATED_WORK_BLOCK",
    date: block.startDay,
    employee: block.employeeName,
    detail:
      `Bloco de turno inválido (${block.effectiveSize}d efetivo, ${block.size}d turno ${block.startDay}..${block.endDay}) — ` +
      `mínimo ${V58_MIN_WORK_BLOCK_SIZE} dias consecutivos T6/T7/T8/T9.`,
  }));
}

export function formatV58NoIsolatedShiftAudit(ws: GenerationWorkspace): string {
  const lines = ["===== V5.8 NO ISOLATED SHIFT =====", ""];
  lines.push("funcionário | data | turno | bloco antes | bloco depois | ação | resultado | motivo");

  if (ws.v58WorkBlockAudit.length === 0) {
    lines.push("(nenhuma ação registrada)");
  } else {
    for (const row of ws.v58WorkBlockAudit) {
      lines.push(
        `${row.name} | ${row.date} | ${row.shift} | ${row.blockBefore} | ${row.blockAfter} | ${row.action} | ${row.result} | ${row.reason}`,
      );
    }
  }

  const invalid = listInvalidV58WorkBlocks(ws);
  lines.push("");
  lines.push(`blocos inválidos restantes: ${invalid.length}`);
  for (const block of invalid) {
    lines.push(`  ${block.employeeName} | ${block.effectiveSize}d efetivo (${block.size}d turno) | ${block.startDay}..${block.endDay}`);
  }
  return lines.join("\n");
}
