import type { Shift } from "../shift/types.js";
import {
  isParallelCoverageType,
  listParallelShiftCodes,
  listRequiredCoverageShiftCodes,
} from "../shift/coverage-type.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Turnos PAO/BOTH ativos que entram na média de turnos alocados (T6/T7/T8/T9/…). */
export function listPaoRateioShiftCodes(shifts: Shift[]): string[] {
  return shifts
    .filter((s) => s.active !== false && (s.role === "PAO" || s.role === "BOTH"))
    .map((s) => s.code.toUpperCase())
    .sort((a, b) => a.localeCompare(b));
}

export function listPaoRateioShiftCodesFromWorkspace(ws: GenerationWorkspace): string[] {
  return listPaoRateioShiftCodes(ws.input.shifts);
}

/** Turnos PAO principais (REQUIRED) — contam como dia trabalhado. */
export function listPaoPrimaryShiftCodes(shifts: Shift[]): string[] {
  const parallel = new Set(listParallelShiftCodes(shifts));
  return listPaoRateioShiftCodes(shifts).filter((code) => !parallel.has(code));
}

export function listPaoPrimaryShiftCodesFromWorkspace(ws: GenerationWorkspace): string[] {
  return listPaoPrimaryShiftCodes(ws.input.shifts);
}

export function isParallelShiftCode(ws: GenerationWorkspace, code: string): boolean {
  const normalized = code.toUpperCase();
  return ws.input.shifts.some(
    (s) => s.code.toUpperCase() === normalized && isParallelCoverageType(s.coverageType),
  );
}

/** Turnos para meta de 20 — REQUIRED primeiro, depois PARALLEL (T9). */
export function listPaoMinShiftFillCodesFromWorkspace(ws: GenerationWorkspace): string[] {
  const rateio = new Set(listPaoRateioShiftCodesFromWorkspace(ws));
  const required = listRequiredCoverageShiftCodes(ws.input.shifts).filter((c) => rateio.has(c));
  const parallel = listParallelShiftCodes(ws.input.shifts).filter((c) => rateio.has(c));
  return [...required, ...parallel.filter((c) => !required.includes(c))];
}

/** Turnos que entram no rateio de turnos (não inclui ND, folgas, voo, cadastros). */
export const RATEIO_TURN_SHIFT_CODES = ["T6", "T7", "T8", "T9"] as const;

export type RateioTurnShiftCode = (typeof RATEIO_TURN_SHIFT_CODES)[number];

export function isRateioTurnShiftCode(code: string): code is RateioTurnShiftCode {
  const upper = code.toUpperCase();
  return (RATEIO_TURN_SHIFT_CODES as readonly string[]).includes(upper);
}

/** Turnos alocados para rateio — somente T6 + T7 + T8 + T9. */
export function countRateioTurns(ws: GenerationWorkspace, uuid: string): number {
  let count = 0;
  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    if (isRateioTurnShiftCode(a.shiftCode)) count++;
  }
  return count;
}

/** @deprecated Use countRateioTurns — mantido como alias. */
export function countAllocatedOperationalTurns(ws: GenerationWorkspace, uuid: string): number {
  return countRateioTurns(ws, uuid);
}

/** Dias trabalhados reais — turnos principais PAO (exclui PARALLEL). */
export function countAllocatedPrimaryTurns(ws: GenerationWorkspace, uuid: string): number {
  const codes = new Set(listPaoPrimaryShiftCodesFromWorkspace(ws));
  let count = 0;
  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    if (codes.has(a.shiftCode.toUpperCase())) count++;
  }
  return count;
}
