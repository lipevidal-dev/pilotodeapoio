/** Turno em instrução: T6 → TI6, T10 → TI10. */

export function isInstructionShiftCode(code: string): boolean {
  const upper = code.trim().toUpperCase();
  return upper.startsWith('TI') && upper.length > 2;
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
  if (upper.startsWith('T') && upper.length > 1) {
    return `TI${upper.slice(1)}`;
  }
  return `TI${upper}`;
}

export function isStationShiftCode(code: string): boolean {
  const base = baseShiftCode(code);
  if (base === 'ND') return false;
  return /^T[A-Z0-9]+$/.test(base);
}

export function applyInstructionShiftIfNeeded(shiftCode: string, inInstruction: boolean): string {
  if (!inInstruction || !isStationShiftCode(shiftCode)) {
    return shiftCode.trim().toUpperCase();
  }
  return toInstructionShiftCode(shiftCode);
}
