import { isoDateKey } from "../rules/date-keys.js";
import {
  applyInstructionShiftIfNeeded,
  baseShiftCode,
  isInInstructionOnDate,
  isStationShiftCode,
} from "./instruction-shift.js";

const BLANK_DASHES = new Set(["-", "—", "–", "−"]);

/** Célula vazia na grade: vazio, "em branco" ou traço (hífen, travessão, meia-risca). */
export function isBlankShiftDisplayToken(code: string | null | undefined): boolean {
  const raw = (code ?? "").trim();
  if (!raw) return true;
  return raw.split("+").every((part) => {
    const p = part.trim();
    if (!p) return true;
    if (BLANK_DASHES.has(p)) return true;
    return p.toLowerCase() === "em branco";
  });
}

/**
 * Token gravado no histórico da troca.
 * Vazio vira ""; turno de estação perde o prefixo de instrução (TI6 → T6).
 */
export function canonicalSwapToken(code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  if (isBlankShiftDisplayToken(raw)) return "";
  return raw
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (!p || isBlankShiftDisplayToken(p)) return "";
      if (isStationShiftCode(p)) return baseShiftCode(p);
      return p.toUpperCase();
    })
    .join("+");
}

export type SwapInstructionEmployee = {
  inInstruction?: boolean;
  instructionStartDate?: Date | string | null;
  instructionEndDate?: Date | string | null;
};

function instructionWindow(employee: SwapInstructionEmployee) {
  const start = employee.instructionStartDate;
  const end = employee.instructionEndDate;
  return {
    inInstruction: employee.inInstruction,
    instructionStartDate: start ? isoDateKey(start) : null,
    instructionEndDate: end ? isoDateKey(end) : null,
  };
}

/**
 * Turno que o destinatário recebe naquele dia civil.
 * TI só permanece se a janela de instrução dele cobre a data.
 */
export function shiftCodeForRecipient(
  shiftCode: string,
  employee: SwapInstructionEmployee,
  isoDate: string,
): string {
  const code = (shiftCode ?? "").trim();
  if (!code || !isStationShiftCode(code)) return code.toUpperCase();
  const inInstruction = isInInstructionOnDate(instructionWindow(employee), isoDate);
  return applyInstructionShiftIfNeeded(baseShiftCode(code), inInstruction);
}
