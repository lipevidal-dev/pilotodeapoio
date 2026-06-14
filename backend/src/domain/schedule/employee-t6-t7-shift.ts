import { addDays } from "../rules/dates.js";
import { listPaoPrimaryShiftCodesFromWorkspace } from "./pao-rateio-shifts.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

export type T6T7ShiftCode = "T6" | "T7";

const T6T7_CODES: T6T7ShiftCode[] = ["T6", "T7"];

function allowedT6T7(ws: GenerationWorkspace, uuid: string): T6T7ShiftCode[] {
  return ws
    .allowedShiftsForEmployee(uuid, T6T7_CODES)
    .map((c) => c.toUpperCase())
    .filter((c): c is T6T7ShiftCode => c === "T6" || c === "T7");
}

function preferredT6T7(ws: GenerationWorkspace, uuid: string): T6T7ShiftCode[] {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return [];
  const preferred = ws.input.preferredShifts?.get(did);
  if (!preferred || preferred.size === 0) return [];
  const allowed = new Set(allowedT6T7(ws, uuid));
  return T6T7_CODES.filter((c) => preferred.has(c) && allowed.has(c));
}

function assignedT6T7(ws: GenerationWorkspace, uuid: string): T6T7ShiftCode[] {
  const found = new Set<T6T7ShiftCode>();
  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    const code = a.shiftCode.toUpperCase();
    if (code === "T6" || code === "T7") found.add(code);
  }
  return [...found];
}

/** Cobertura T6/T7 faltante na janela do bloco (somente códigos permitidos). */
export function pickShiftByCoverageGaps(
  ws: GenerationWorkspace,
  days: string[],
  allowed: readonly T6T7ShiftCode[],
): T6T7ShiftCode {
  const pool = allowed.length > 0 ? allowed : T6T7_CODES;
  let t6Need = 0;
  let t7Need = 0;
  for (const day of days) {
    if (pool.includes("T6") && !ws.hasPaoCoverage(day, "T6")) t6Need++;
    if (pool.includes("T7") && !ws.hasPaoCoverage(day, "T7")) t7Need++;
  }
  if (t7Need > t6Need && pool.includes("T7")) return "T7";
  if (t6Need > t7Need && pool.includes("T6")) return "T6";
  return pool.includes("T6") ? "T6" : pool[0]!;
}

/**
 * Define o turno T6/T7 do funcionário para todo o mês.
 * Prioridade: lock → único permitido → preferência cadastrada → turno já alocado → cobertura.
 */
export function resolveEmployeeT6T7Code(
  ws: GenerationWorkspace,
  uuid: string,
  blockDays: string[] = [],
): T6T7ShiftCode {
  const locked = ws.getEmployeeT6T7Lock(uuid);
  if (locked) return locked;

  const allowed = allowedT6T7(ws, uuid);
  if (allowed.length === 0) {
    return pickShiftByCoverageGaps(ws, blockDays, T6T7_CODES);
  }
  if (allowed.length === 1) {
    ws.setEmployeeT6T7Lock(uuid, allowed[0]!);
    return allowed[0]!;
  }

  const preferred = preferredT6T7(ws, uuid);
  if (preferred.length === 1) {
    ws.setEmployeeT6T7Lock(uuid, preferred[0]!);
    return preferred[0]!;
  }
  if (preferred.length > 1) {
    const code = pickShiftByCoverageGaps(ws, blockDays.length > 0 ? blockDays : ws.days, preferred);
    ws.setEmployeeT6T7Lock(uuid, code);
    return code;
  }

  const assigned = assignedT6T7(ws, uuid);
  if (assigned.length === 1) {
    ws.setEmployeeT6T7Lock(uuid, assigned[0]!);
    return assigned[0]!;
  }

  return pickShiftByCoverageGaps(ws, blockDays.length > 0 ? blockDays : ws.days, allowed);
}

/** Confirma o lock após primeiro bloco materializado com sucesso. */
export function confirmEmployeeT6T7Lock(ws: GenerationWorkspace, uuid: string, code: T6T7ShiftCode): void {
  ws.setEmployeeT6T7Lock(uuid, code);
}

/** Turno T6/T7 dominante do funcionário (para cobertura residual). */
export function employeeDominantT6T7OrResolve(
  ws: GenerationWorkspace,
  uuid: string,
  gapDays: string[],
): T6T7ShiftCode {
  return resolveEmployeeT6T7Code(ws, uuid, gapDays);
}

/** Lista turnos principais PAO (T6/T7/T8) preferidos no cadastro. */
export function preferredPrimaryShiftCodes(ws: GenerationWorkspace, uuid: string): string[] {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return [];
  const preferred = ws.input.preferredShifts?.get(did);
  if (!preferred) return [];
  const primary = new Set(listPaoPrimaryShiftCodesFromWorkspace(ws));
  return [...preferred].filter((c) => primary.has(c.toUpperCase()));
}

export function blockDaysFromStart(startDay: string, size: number): string[] {
  return Array.from({ length: size }, (_, i) => addDays(startDay, i));
}

/** PAO com preferência exclusiva em turno paralelo (ex.: T9) — não recebe blocos T6/T7. */
export function isParallelOnlyPreferredPao(ws: GenerationWorkspace, uuid: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const preferred = ws.input.preferredShifts?.get(did);
  if (!preferred || preferred.size === 0) return false;

  const parallel = new Set(listParallelShiftCodes(ws.input.shifts));
  const primary = new Set(listPaoPrimaryShiftCodesFromWorkspace(ws));

  const hasParallel = [...preferred].some((c) => parallel.has(c.toUpperCase()));
  const hasPrimary = [...preferred].some((c) => primary.has(c.toUpperCase()));
  return hasParallel && !hasPrimary;
}

/** PAO com preferência exclusiva em T8 — minimiza blocos T6/T7 (T8 vem do motor T8/T8/ND). */
export function isT8PreferredPao(ws: GenerationWorkspace, uuid: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  return ws.input.preferredShifts?.get(did)?.has("T8") ?? false;
}
