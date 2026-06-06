import { PAO_COVERAGE_SHIFTS } from "../rules/constants.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Turnos operacionais que contam na meta de 20 turnos/mês (PAO mês inteiro sem voo). */
export const OPERATIONAL_SHIFT_CODES = new Set<string>([...PAO_COVERAGE_SHIFTS, "ND"]);

/**
 * Pré-alocações que contam como turno no domínio atual.
 * Apenas códigos de turno explícitos (T6/T7/T8/ND) — bloqueios (CMA, CURSO, SIMULADOR) não entram.
 */
const PREALLOC_SHIFT_LABELS = new Set(["T6", "T7", "T8", "ND"]);

export function isOperationalShiftLabel(label: string): boolean {
  const upper = normalizeOperationalLabel(label).toUpperCase();
  return OPERATIONAL_SHIFT_CODES.has(upper) || PREALLOC_SHIFT_LABELS.has(upper);
}

/** Conta turnos operacionais do PAO no mês (T6/T7/T8/ND + pré-alocações de turno). */
export function countOperationalShifts(ws: GenerationWorkspace, uuid: string): number {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return 0;

  let count = 0;
  for (const day of ws.days) {
    const shift = ws.planned.get(`${did}|${day}`);
    if (shift && OPERATIONAL_SHIFT_CODES.has(shift)) {
      count++;
      continue;
    }
    const blockedLabel = ws.blocked.get(`${did}|${day}`);
    if (blockedLabel === "ND") {
      count++;
      continue;
    }
    if (blockedLabel && PREALLOC_SHIFT_LABELS.has(normalizeOperationalLabel(blockedLabel).toUpperCase())) {
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
  const out: Record<string, number> = { T6: 0, T7: 0, T8: 0, ND: 0 };
  if (!did) return out;

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
