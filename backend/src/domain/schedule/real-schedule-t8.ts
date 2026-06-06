import { addDays } from "../rules/dates.js";
import { sortPaoByOperationalPriority } from "./pao-operational-priority.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";

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

/** Audita T8 isolado e duplas T8/T8 sem ND obrigatório. */
export function auditStructuralT8(ws: GenerationWorkspace): StructuralT8Audit {
  const warnings: ValidationIssue[] = [];
  let isolatedT8Count = 0;
  let pairsWithoutNdCount = 0;
  let t8BlocksCount = 0;

  for (const c of ws.paoEmps) {
    const name = c.employee.name;

    for (const day of ws.days) {
      if (shiftCodeOnDay(ws, c.uuid, day) !== "T8") continue;

      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const prevT8 = ws.days.includes(prev) && shiftCodeOnDay(ws, c.uuid, prev) === "T8";
      const nextT8 = ws.days.includes(next) && shiftCodeOnDay(ws, c.uuid, next) === "T8";

      if (!prevT8 && !nextT8) {
        isolatedT8Count++;
        warnings.push({
          severity: "ALTA",
          level: "CRITICAL",
          type: "T8 ISOLADO",
          date: day,
          employee: name,
          detail: `T8 isolado em ${day} — bloco T8/T8/ND obrigatório.`,
        });
        continue;
      }

      if (nextT8 && !prevT8) {
        t8BlocksCount++;
        const ndDay = addDays(next, 1);
        const hasNd = ws.allocations.some(
          (a) => a.employeeUuid === c.uuid && a.date === ndDay && a.label === "ND",
        );

        if (!hasNd) {
          pairsWithoutNdCount++;
          warnings.push({
            severity: "ALTA",
            level: "CRITICAL",
            type: "T8 SEM ND",
            date: ndDay,
            employee: name,
            detail: `Dupla T8/T8 (${day}/${next}) sem ND em ${ndDay}.`,
          });
        }
      }
    }
  }

  return { isolatedT8Count, pairsWithoutNdCount, t8BlocksCount, warnings };
}

/**
 * Aloca T8 somente via blocos completos T8/T8/ND.
 * Não forma dupla se o terceiro dia (ND) estiver bloqueado.
 */
export function allocateT8BlocksStrict(ws: GenerationWorkspace): T8AllocationResult {
  let blocksBefore = countT8Blocks(ws);

  for (let di = 0; di < ws.days.length; di++) {
    const day = ws.days[di]!;
    if (ws.hasPaoCoverage(day, "T8")) continue;

    const rotated = sortPaoByOperationalPriority(ws, di);
    ws.tryAssignT8Coverage(day, rotated);
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
  for (const day of ws.days) {
    if (ws.hasPaoCoverage(day, "T8")) continue;
    if (ws.tryAssignT8Coverage(day)) closed++;
  }
  ws.repairIsolatedT8();
  ws.cleanupOrphanNd();
  ws.ensureNdForT8Pairs();
  return closed;
}
