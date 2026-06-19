import { RATEIO_TURN_CODES } from "../clean-engine/clean-types.js";

const RATEIO_ORDER = new Map<string, number>(
  RATEIO_TURN_CODES.map((code, index) => [code, index]),
);

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function sortRateioCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => {
    const ai = RATEIO_ORDER.get(a) ?? 99;
    const bi = RATEIO_ORDER.get(b) ?? 99;
    return ai - bi;
  });
}

/** Filtra códigos válidos e ativos; array vazio após filtro vira null (todos). */
export function sanitizeAllowedShiftCodes(
  codes: string[] | null | undefined,
  activeRateioCodes: string[],
): string[] | null {
  if (codes === null || codes === undefined) return null;
  const active = new Set(activeRateioCodes.map(normalizeCode));
  const filtered = sortRateioCodes(
    [...new Set(codes.map(normalizeCode).filter((code) => active.has(code)))],
  );
  return filtered.length > 0 ? filtered : null;
}

/** Turnos efetivos na geração: null no config = todos os rateio ativos. */
export function resolveAllowedShiftCodes(
  stored: string[] | null | undefined,
  activeRateioCodes: string[],
): string[] {
  const active = sortRateioCodes(activeRateioCodes.map(normalizeCode));
  const sanitized = sanitizeAllowedShiftCodes(stored, active);
  return sanitized ?? active;
}

export function allowedShiftCodesEqual(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
  activeRateioCodes: string[],
): boolean {
  const left = resolveAllowedShiftCodes(a, activeRateioCodes);
  const right = resolveAllowedShiftCodes(b, activeRateioCodes);
  return left.length === right.length && left.every((code, i) => code === right[i]);
}
