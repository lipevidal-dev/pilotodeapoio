/** Piso histórico T6/T7 quando o agrupamento configurado não se aplica. */
export const MIN_RATEIO_BLOCK_SIZE = 3;

export function minimumBlockSizeForShift(shiftCode: string): number {
  const code = shiftCode.toUpperCase();
  if (code === "T9" || code === "T8") return 1;
  return MIN_RATEIO_BLOCK_SIZE;
}

/**
 * Tamanho de bloco exigido pelo motor: agrupamento configurado (ex.: 5),
 * nunca abaixo do piso T6/T7. T8/T9 permanecem unitários.
 */
export function requiredBlockSizeForShift(
  shiftCode: string,
  agrupamentoDays: number,
): number {
  const hardMin = minimumBlockSizeForShift(shiftCode);
  if (hardMin < MIN_RATEIO_BLOCK_SIZE) return hardMin;
  const agrupamento = Math.max(1, Math.floor(agrupamentoDays));
  return Math.max(hardMin, agrupamento);
}

export function agrupamentoMinForShift(shiftCode: string): number {
  return minimumBlockSizeForShift(shiftCode);
}
