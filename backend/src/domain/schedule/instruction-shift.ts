/** Turno em instrução: T6 → TI6, T10 → TI10, T1 → TI1. */

export function isInstructionShiftCode(code: string): boolean {
  const upper = code.trim().toUpperCase();
  return upper.startsWith("TI") && upper.length > 2;
}

export function baseShiftCode(code: string): string {
  const upper = code.trim().toUpperCase();
  if (isInstructionShiftCode(upper)) {
    return `T${upper.slice(2)}`;
  }
  return upper;
}

export function toInstructionShiftCode(baseCode: string): string {
  const upper = baseCode.trim().toUpperCase();
  if (isInstructionShiftCode(upper)) return upper;
  if (upper.startsWith("T") && upper.length > 1) {
    return `TI${upper.slice(1)}`;
  }
  return `TI${upper}`;
}

/** Turnos de estação (não ND / operacional). */
export function isStationShiftCode(code: string): boolean {
  const base = baseShiftCode(code);
  if (base === "ND") return false;
  return /^T[A-Z0-9]+$/.test(base);
}

export function applyInstructionShiftIfNeeded(
  shiftCode: string,
  inInstruction: boolean,
): string {
  if (!inInstruction || !isStationShiftCode(shiftCode)) {
    return shiftCode.trim().toUpperCase();
  }
  return toInstructionShiftCode(shiftCode);
}

type InstructionWindow = {
  inInstruction?: boolean;
  instructionStartDate?: string | null;
  instructionEndDate?: string | null;
};

/**
 * Instrução no dia civil:
 * - Se há janela (início/fim), vale só dentro dela (flag stale fora da janela é ignorada).
 * - Sem janela, usa o boolean `inInstruction`.
 */
export function isInInstructionOnDate(
  employee: InstructionWindow,
  date: string,
): boolean {
  const start = employee.instructionStartDate ?? null;
  const end = employee.instructionEndDate ?? null;
  if (start || end) {
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  }
  return Boolean(employee.inInstruction);
}
