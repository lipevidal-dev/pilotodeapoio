/** Bloco mínimo de turnos consecutivos T6/T7 (T8 usa T8/T8/ND; T9 é unitário). */
export const MIN_RATEIO_BLOCK_SIZE = 3;

export function minimumBlockSizeForShift(shiftCode: string): number {
  const code = shiftCode.toUpperCase();
  if (code === "T9" || code === "T8") return 1;
  return MIN_RATEIO_BLOCK_SIZE;
}

export function agrupamentoMinForShift(shiftCode: string): number {
  return minimumBlockSizeForShift(shiftCode);
}
