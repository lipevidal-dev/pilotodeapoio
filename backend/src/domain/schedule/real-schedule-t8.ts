import { addDays } from "../rules/dates.js";
import { sortPaoByOperationalPriority } from "./pao-operational-priority.js";
import {
  employeeCanStartT8Block,
} from "./t8-block-limits.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";
import { sortPaoByRateioPriority } from "./schedule-rateio-context.js";
import { auditT8NdFromGridSource, finalizeT8NdBlocks } from "./schedule-grid-source.js";

export function sortT8Candidates(
  ws: GenerationWorkspace,
  dayIndex: number,
  coverageEmergency = false,
): GenerationInputEmployee[] {
  const ctx = ws.ensureRateioContext();
  const base = sortPaoByOperationalPriority(ws, dayIndex).filter((c) =>
    employeeCanStartT8Block(ws, c.uuid, coverageEmergency),
  );
  return sortPaoByRateioPriority(
    ws,
    ctx,
    "T8",
    base.map((c) => ({ uuid: c.uuid, seniority: c.employee.seniority })),
    { allowEmergency: coverageEmergency },
  ).map((c) => base.find((b) => b.uuid === c.uuid)!);
}

export interface StructuralT8Audit {
  isolatedT8Count: number;
  pairsWithoutNdCount: number;
  t8BlocksCount: number;
  warnings: ValidationIssue[];
}

export interface T8AllocationResult {
  blocksPlaced: number;
  coverageGaps: number;
  audit: StructuralT8Audit;
}

function shiftCodeOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

function countT8Blocks(ws: GenerationWorkspace): number {
  let blocks = 0;
  const seen = new Set<string>();

  for (const c of ws.paoEmps) {
    for (const day of ws.days) {
      const key = `${c.uuid}|${day}`;
      if (seen.has(key)) continue;
      if (shiftCodeOnDay(ws, c.uuid, day) !== "T8") continue;
      const next = addDays(day, 1);
      if (shiftCodeOnDay(ws, c.uuid, next) === "T8") {
        blocks++;
        seen.add(key);
        seen.add(`${c.uuid}|${next}`);
      }
    }
  }
  return blocks;
}

/** Audita T8 isolado e duplas T8/T8 sem ND obrigatório (fonte unificada da grade). */
export function auditStructuralT8(ws: GenerationWorkspace): StructuralT8Audit {
  const audit = auditT8NdFromGridSource(ws);
  return {
    isolatedT8Count: audit.isolatedT8Count,
    pairsWithoutNdCount: audit.pairsWithoutNdCount,
    t8BlocksCount: audit.t8BlocksCount,
    warnings: audit.warnings,
  };
}

/**
 * Aloca T8 somente via blocos completos T8/T8/ND.
 * Não forma dupla se o terceiro dia (ND) estiver bloqueado.
 */
export function allocateT8BlocksStrict(ws: GenerationWorkspace): T8AllocationResult {
  let blocksBefore = countT8Blocks(ws);
  let blockIndex = 0;

  for (let di = 0; di < ws.days.length; di++) {
    const day = ws.days[di]!;
    if (ws.hasPaoCoverage(day, "T8")) continue;

    const rotated = sortT8Candidates(ws, di);
    let placed = false;
    for (let attempt = 0; attempt < rotated.length; attempt++) {
      const c = rotated[(blockIndex + attempt) % rotated.length]!;
      if (ws.tryAssignT8Coverage(day, [c])) {
        placed = true;
        blockIndex++;
        break;
      }
    }
    if (!placed) {
      ws.tryAssignT8Coverage(day, rotated);
    }
  }

  ws.repairIsolatedT8();
  ws.cleanupOrphanNd();
  ws.ensureNdForT8Pairs();

  const blocksPlaced = Math.max(0, countT8Blocks(ws) - blocksBefore);
  const audit = auditStructuralT8(ws);

  const coverageGaps = ws.days.filter((day) => !ws.hasPaoCoverage(day, "T8")).length;

  return { blocksPlaced, coverageGaps, audit };
}

/** Fecha furos T8 restantes sem criar T8 isolado. */
export function closeT8CoverageGaps(ws: GenerationWorkspace): number {
  let closed = 0;
  for (let di = 0; di < ws.days.length; di++) {
    const day = ws.days[di]!;
    if (ws.hasPaoCoverage(day, "T8")) continue;
    const rotated = sortT8Candidates(ws, di, false);
    if (ws.tryAssignT8Coverage(day, rotated)) {
      closed++;
      continue;
    }
    const emergency = sortT8Candidates(ws, di, true);
    if (ws.tryAssignT8Coverage(day, emergency, true)) closed++;
  }
  ws.repairIsolatedT8();
  finalizeT8NdBlocks(ws);
  return closed;
}
