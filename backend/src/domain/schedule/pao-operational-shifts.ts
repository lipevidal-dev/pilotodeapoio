import type { GenerationWorkspace } from "./generation-workspace.js";import { listPaoRateioShiftCodesFromWorkspace } from "./pao-rateio-shifts.js";
import { normalizeOperationalLabel } from "./operational-labels.js";

/** Turnos operacionais que contam na meta de turnos/mês (dinâmico: T6–T9… + ND). */
export function operationalShiftCodes(ws: GenerationWorkspace): Set<string> {
  return new Set([...listPaoRateioShiftCodesFromWorkspace(ws), "ND"]);
}

/**
 * Pré-alocações que contam como turno no domínio atual.
 * Apenas códigos de turno explícitos — bloqueios (CMA, CURSO, SIMULADOR) não entram.
 */
const PREALLOC_SHIFT_LABELS = new Set(["ND"]);

export function isOperationalShiftLabel(label: string, ws: GenerationWorkspace): boolean {
  const upper = normalizeOperationalLabel(label).toUpperCase();
  return operationalShiftCodes(ws).has(upper) || PREALLOC_SHIFT_LABELS.has(upper);
}

/** Conta turnos operacionais do PAO no mês. */
export function countOperationalShifts(ws: GenerationWorkspace, uuid: string): number {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return 0;
  const codes = operationalShiftCodes(ws);

  let count = 0;
  for (const day of ws.days) {
    const shift = ws.planned.get(`${did}|${day}`);
    if (shift && codes.has(shift)) {
      count++;
      continue;
    }
    const blockedLabel = ws.blocked.get(`${did}|${day}`);
    if (blockedLabel === "ND") {
      count++;
      continue;
    }
    if (blockedLabel && codes.has(normalizeOperationalLabel(blockedLabel).toUpperCase())) {
      count++;
    }
  }
  return count;
}

export function operationalShiftBreakdown(
  ws: GenerationWorkspace,
  uuid: string,
): Record<string, number> {
  const did = ws.uuidToDomain.get(uuid);
  const out: Record<string, number> = {};
  if (!did) return out;

  for (const code of operationalShiftCodes(ws)) out[code] = 0;
  out.ND = 0;

  for (const day of ws.days) {
    const shift = ws.planned.get(`${did}|${day}`);
    if (shift && shift in out) {
      out[shift]++;
      continue;
    }
    const blockedLabel = ws.blocked.get(`${did}|${day}`);
    if (blockedLabel === "ND") out.ND++;
  }
  return out;
}

/** @deprecated use operationalShiftCodes(ws) */
export const OPERATIONAL_SHIFT_CODES = new Set<string>(["T6", "T7", "T8", "ND"]);
