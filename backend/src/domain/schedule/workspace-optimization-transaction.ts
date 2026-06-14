import { validateSchedule } from "../rules/engine.js";
import { auditT8NdFromGridSource } from "./schedule-grid-source.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GeneratedAllocation } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { syncRateioCountsFromWorkspace } from "./schedule-rateio-context.js";

export interface OptimizationSnapshot {
  planned: Map<string, string>;
  blocked: Map<string, string>;
  allocations: GeneratedAllocation[];
  emergencyIsolatedT8: Array<{ employeeUuid: string; date: string }>;
}

export function captureOptimizationSnapshot(ws: GenerationWorkspace): OptimizationSnapshot {
  return {
    planned: new Map(ws.planned),
    blocked: new Map(ws.blocked),
    allocations: ws.allocations.map((a) => ({ ...a })),
    emergencyIsolatedT8: ws.listEmergencyIsolatedT8Days().map((e) => ({ ...e })),
  };
}

export function restoreOptimizationSnapshot(
  ws: GenerationWorkspace,
  snap: OptimizationSnapshot,
): void {
  ws.planned.clear();
  for (const [key, value] of snap.planned) ws.planned.set(key, value);

  ws.blocked.clear();
  for (const [key, value] of snap.blocked) ws.blocked.set(key, value);

  ws.allocations.length = 0;
  ws.allocations.push(...snap.allocations.map((a) => ({ ...a })));

  for (const e of ws.listEmergencyIsolatedT8Days()) {
    ws.clearEmergencyIsolatedT8(e.employeeUuid, e.date);
  }
  for (const e of snap.emergencyIsolatedT8) {
    ws.markEmergencyIsolatedT8(e.employeeUuid, e.date);
  }

  ws.clearCoverageGapsCache();
  if (ws.rateioContext) syncRateioCountsFromWorkspace(ws, ws.rateioContext);
}

function shiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

function hasDuplicateShiftCoverage(ws: GenerationWorkspace, code: string): boolean {
  for (const day of ws.days) {
    let count = 0;
    for (const c of ws.paoEmps) {
      if (shiftOnDay(ws, c.uuid, day) === code) count++;
    }
    if (count > 1) return true;
  }
  return false;
}

function lockedPreallocationsIntact(ws: GenerationWorkspace): boolean {
  for (const lock of ws.input.lockedAllocations) {
    const want = normalizeOperationalLabel(lock.label).toUpperCase();
    const inAlloc = ws.allocations.some(
      (a) =>
        a.employeeUuid === lock.employeeUuid &&
        a.date === lock.date &&
        normalizeOperationalLabel(a.label).toUpperCase() === want,
    );
    if (inAlloc) continue;

    const did = ws.uuidToDomain.get(lock.employeeUuid);
    if (did == null) return false;
    const blocked = ws.blocked.get(`${did}|${lock.date}`);
    if (normalizeOperationalLabel(blocked ?? "").toUpperCase() !== want) return false;
  }
  return true;
}

function t8CoverageByDayFromSnapshot(
  snap: OptimizationSnapshot,
  ws: GenerationWorkspace,
  day: string,
): boolean {
  for (const c of ws.paoEmps) {
    const did = ws.uuidToDomain.get(c.uuid);
    if (did == null) continue;
    if (snap.planned.get(`${did}|${day}`) === "T8") return true;
  }
  return false;
}

/** Valida cobertura T6/T7/T8 em todos os dias (cache limpo). */
export function validateFullShiftCoverage(ws: GenerationWorkspace): { ok: boolean; reason: string } {
  ws.clearCoverageGapsCache();
  const gaps = ws.listCoverageGaps();
  if (gaps.length > 0) {
    const first = gaps[0]!;
    return { ok: false, reason: `COBERTURA_GAP_${first.shiftCode}_${first.date}` };
  }
  return { ok: true, reason: "OK" };
}

/** Valida estado pós-movimento — cobertura, ND, duplicatas, pré-alocações. */
export function validateOptimizationState(
  ws: GenerationWorkspace,
  baseline?: OptimizationSnapshot,
): { ok: boolean; reason: string } {
  ws.clearCoverageGapsCache();
  const coverage = validateFullShiftCoverage(ws);
  if (!coverage.ok) return coverage;

  if (hasDuplicateShiftCoverage(ws, "T8")) {
    return { ok: false, reason: "DUPLICATA_T8" };
  }
  if (hasDuplicateShiftCoverage(ws, "T6") || hasDuplicateShiftCoverage(ws, "T7")) {
    return { ok: false, reason: "DUPLICATA_T6_T7" };
  }

  if (!lockedPreallocationsIntact(ws)) {
    return { ok: false, reason: "PREALOCACAO_SOBRESCRITA" };
  }

  const t8Audit = auditT8NdFromGridSource(ws);
  if (t8Audit.pairsWithoutNdCount > 0) {
    return { ok: false, reason: "T8_SEM_ND" };
  }
  if (t8Audit.isolatedT8Count > 0) {
    return { ok: false, reason: "T8_ISOLADO" };
  }

  if (baseline) {
    for (const day of ws.days) {
      const before = t8CoverageByDayFromSnapshot(baseline, ws, day);
      const after = ws.hasPaoCoverage(day, "T8");
      if (before !== after) {
        return { ok: false, reason: `T8_COBERTURA_ALTERADA_${day}` };
      }
    }
  }

  const issues = validateSchedule(ws.toScheduleContext());
  if (issues.some((i) => i.level === "CRITICAL" || i.severity === "ALTA")) {
    const first = issues.find((i) => i.level === "CRITICAL" || i.severity === "ALTA");
    return { ok: false, reason: first?.type ?? "VALIDACAO_CRITICA" };
  }

  return { ok: true, reason: "OK" };
}

/** Tenta mutação com rollback automático se validação falhar. */
export function tryOptimizationMutation(
  ws: GenerationWorkspace,
  baseline: OptimizationSnapshot,
  mutate: () => void,
): { ok: boolean; reason: string } {
  const snap = captureOptimizationSnapshot(ws);
  mutate();
  const result = validateOptimizationState(ws, baseline);
  if (!result.ok) {
    restoreOptimizationSnapshot(ws, snap);
  }
  return result;
}
