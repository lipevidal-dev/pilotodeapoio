/** Instrução no dia civil da grade. */

type InstructionWindow = {
  inInstruction?: boolean;
  instructionStartDate?: string | null;
  instructionEndDate?: string | null;
};

/**
 * Se há janela (início/fim), vale só dentro dela.
 * Sem janela, usa o boolean `inInstruction`.
 */
export function isEmployeeInInstructionOnDate(
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
