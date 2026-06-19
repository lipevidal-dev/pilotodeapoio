export type RateioShiftCode = 'T6' | 'T7' | 'T8' | 'T9';

export const RATEIO_SHIFT_CODES: readonly RateioShiftCode[] = ['T6', 'T7', 'T8', 'T9'];

const RATEIO_SHIFT_CODE_SET = new Set<string>(RATEIO_SHIFT_CODES);

export function isRateioShiftCode(code: string): code is RateioShiftCode {
  return RATEIO_SHIFT_CODE_SET.has(code.toUpperCase());
}

export function asRateioShiftCode(code: string): RateioShiftCode | null {
  const upper = code.toUpperCase();
  return isRateioShiftCode(upper) ? upper : null;
}

export const RATEIO_SHIFT_ORDER = new Map<RateioShiftCode, number>(
  RATEIO_SHIFT_CODES.map((code, index) => [code, index]),
);
