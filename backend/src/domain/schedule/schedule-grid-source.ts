import { addDays } from "../rules/dates.js";
import { PROTECTED_PREALLOC_TYPES, VACATION_TYPES } from "../rules/constants.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";
import { isV5PreferredPhaseDay } from "./v5-preferred-phase-guard.js";

/** Labels que impedem materialização de ND gerado pelo motor. */
const ND_HARD_BLOCK_LABELS = new Set([
  "FÉRIAS",
  "FERIAS",
  "FOLGA PEDIDA",
  "FP",
  "FOLGA ANIVERSÁRIO",
  "FANI",
]);

/** Folgas geradas pelo motor — cedem ao ND obrigatório pós T8/T8. */
const ND_REPLACABLE_GENERATOR_LABELS = new Set([
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA AGRUPADA",
]);

export interface ScheduleGridLabel {
  employeeUuid: string;
  date: string;
  kind: "shift" | "label";
  value: string;
}

/** ND visível na grade — mesma regra do frontend (preAllocations + blocked). */
export function hasNdOnGrid(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const blocked = ws.blocked.get(`${did}|${day}`);
  if (blocked?.toUpperCase() === "ND") return true;
  return ws.allocations.some(
    (a) => a.employeeUuid === uuid && a.date === day && a.label.toUpperCase() === "ND",
  );
}

/**
 * Pré-alocação fixa / bloqueio duro — ND não pode substituir.
 * Não confundir com isLockedByAdmin (folgas geradas também bloqueiam turnos).
 */
export function isNdOverrideProtected(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  if (
    ws.input.lockedAllocations.some(
      (l) => l.employeeUuid === uuid && l.date === day,
    )
  ) {
    return true;
  }
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return true;
  const label = ws.blocked.get(`${did}|${day}`);
  if (!label) return false;
  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (VACATION_TYPES.has(upper) || upper.includes("FERIAS")) return true;
  if (ND_HARD_BLOCK_LABELS.has(upper)) return true;
  if (upper.includes("FOLGA ANIVERS") || upper === "FANI") return true;
  if (
    PROTECTED_PREALLOC_TYPES.has(upper) &&
    !ND_REPLACABLE_GENERATOR_LABELS.has(upper)
  ) {
    return true;
  }
  return false;
}

export function isNdPlacementBlocked(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  return isNdOverrideProtected(ws, uuid, day);
}

function clearReplaceableGeneratorLabelForNd(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): void {
  if (isNdOverrideProtected(ws, uuid, day)) return;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return;
  const label = ws.blocked.get(`${did}|${day}`);
  if (!label) return;
  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (!ND_REPLACABLE_GENERATOR_LABELS.has(upper) && !upper.includes("FOLGA")) return;
  if (ND_HARD_BLOCK_LABELS.has(upper)) return;
  if (upper.includes("FOLGA PEDIDA") || upper === "FP") return;
  if (upper.includes("FOLGA ANIVERS") || upper === "FANI") return;

  ws.blocked.delete(`${did}|${day}`);
  const idx = ws.allocations.findIndex((a) => a.employeeUuid === uuid && a.date === day);
  if (idx >= 0) ws.allocations.splice(idx, 1);
}

export function clearNdDayConflicts(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): void {
  clearReplaceableGeneratorLabelForNd(ws, uuid, day);
  clearGeneratorShiftForNdDay(ws, uuid, day);
}

/** Turno conflitante no dia ND — removido pelo motor (inclui T8 inválido no 3º dia). */
export function clearGeneratorShiftForNdDay(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  if (isNdOverrideProtected(ws, uuid, day)) return false;
  const code = ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
  if (!code) return true;
  if (isV5PreferredPhaseDay(ws, uuid, day)) return false;
  return ws.unassignShift(uuid, day, {
    bypassT8Protection: true,
    bypassPreferredPhaseProtection: true,
    preferredRemovalReason: "ND_DAY_CONFLICT",
    preferredRemovalDetail: "turno conflitante no dia ND pós T8/T8",
  });
}

export function buildScheduleGridLabels(ws: GenerationWorkspace): ScheduleGridLabel[] {
  const out: ScheduleGridLabel[] = [];
  for (const a of ws.toAssignments()) {
    out.push({
      employeeUuid: a.employeeUuid,
      date: a.date,
      kind: "shift",
      value: a.shiftCode,
    });
  }
  for (const al of ws.allocations) {
    out.push({
      employeeUuid: al.employeeUuid,
      date: al.date,
      kind: "label",
      value: al.label,
    });
  }
  return out;
}

export interface T8NdAuditResult {
  isolatedT8Count: number;
  pairsWithoutNdCount: number;
  t8BlocksCount: number;
  ndOutsideMonthCount: number;
  warnings: ValidationIssue[];
}

function shiftCodeOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

/** Dia reservado a ND após par T8/T8 do mesmo funcionário — não recebe T8 isolado. */
export function isNdDayAfterOwnT8Pair(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  const d2 = addDays(day, -1);
  const d1 = addDays(day, -2);
  if (!ws.days.includes(d1) || !ws.days.includes(d2)) return false;
  return shiftCodeOnDay(ws, uuid, d1) === "T8" && shiftCodeOnDay(ws, uuid, d2) === "T8";
}

/**
 * Audita T8/T8/ND usando a mesma fonte da grade (assignments + allocations/blocked).
 * Pares cujo ND cai fora do mês não contam como violação in-month.
 */
export function auditT8NdFromGridSource(ws: GenerationWorkspace): T8NdAuditResult {
  const warnings: ValidationIssue[] = [];
  let isolatedT8Count = 0;
  let pairsWithoutNdCount = 0;
  let t8BlocksCount = 0;
  let ndOutsideMonthCount = 0;

  for (const c of ws.paoEmps) {
    const name = c.employee.name;

    for (const day of ws.days) {
      if (shiftCodeOnDay(ws, c.uuid, day) !== "T8") continue;

      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const prevT8 = ws.days.includes(prev) && shiftCodeOnDay(ws, c.uuid, prev) === "T8";
      const nextT8 = ws.days.includes(next) && shiftCodeOnDay(ws, c.uuid, next) === "T8";

      if (!prevT8 && !nextT8) {
        if (ws.isEmergencyIsolatedT8(c.uuid, day)) {
          warnings.push({
            severity: "MÉDIA",
            level: "WARNING",
            type: "RATEIO_T8_EMERGENCY_ISOLATED",
            date: day,
            employee: name,
            detail: `T8 isolado emergencial em ${day} — cobertura preservada pós-dedup.`,
          });
          continue;
        }
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

        if (!ws.days.includes(ndDay)) {
          if (hasNdOnGrid(ws, c.uuid, ndDay)) {
            ndOutsideMonthCount++;
          }
          continue;
        }

        if (isNdPlacementBlocked(ws, c.uuid, ndDay)) continue;

        if (!hasNdOnGrid(ws, c.uuid, ndDay)) {
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

  return {
    isolatedT8Count,
    pairsWithoutNdCount,
    t8BlocksCount,
    ndOutsideMonthCount,
    warnings,
  };
}

/** Garante ND após todos os passos do motor (dedup, optimizer, paralelo). */
export function finalizeT8NdBlocks(ws: GenerationWorkspace): void {
  ws.repairIsolatedT8();
  ws.reconcileNdAfterParallelShifts();
  ws.ensureNdForT8Pairs();
  ensureCrossMonthNdForT8Pairs(ws);
  ws.cleanupOrphanNd();
}

/** V5 pré-repair — preserva T8 mono da fase preferida (não chama repairIsolatedT8). */
export function finalizeT8NdBlocksForV5PreRepair(ws: GenerationWorkspace): void {
  ws.reconcileNdAfterParallelShifts();
  ws.ensureNdForT8Pairs();
  ensureCrossMonthNdForT8Pairs(ws);
  ws.cleanupOrphanNd();
}

/** ND após par T8/T8 cujo terceiro dia cai fora do mês corrente. */
function ensureCrossMonthNdForT8Pairs(ws: GenerationWorkspace): void {
  for (const c of ws.paoEmps) {
    for (let i = 0; i < ws.days.length - 1; i++) {
      const d1 = ws.days[i]!;
      const d2 = ws.days[i + 1]!;
      if (shiftCodeOnDay(ws, c.uuid, addDays(d1, -1)) === "T8") continue;
      if (shiftCodeOnDay(ws, c.uuid, d1) !== "T8" || shiftCodeOnDay(ws, c.uuid, d2) !== "T8") {
        continue;
      }

      const ndDay = addDays(d2, 1);
      if (ws.days.includes(ndDay)) continue;
      if (isNdPlacementBlocked(ws, c.uuid, ndDay)) continue;
      clearNdDayConflicts(ws, c.uuid, ndDay);
      if (!hasNdOnGrid(ws, c.uuid, ndDay)) {
        ws.lockDay(c.uuid, ndDay, "ND");
      }
    }
  }
}
