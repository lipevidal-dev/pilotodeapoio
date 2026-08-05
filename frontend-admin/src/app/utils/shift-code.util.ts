export type RateioShiftCode = 'T6' | 'T7' | 'T8' | 'T9';
export type ApaoShiftCode = 'T1' | 'T2' | 'T3' | 'T4';

export const RATEIO_SHIFT_CODES: readonly RateioShiftCode[] = ['T6', 'T7', 'T8', 'T9'];
export const APAO_SHIFT_CODES: readonly ApaoShiftCode[] = ['T1', 'T2', 'T3', 'T4'];

const RATEIO_SHIFT_CODE_SET = new Set<string>(RATEIO_SHIFT_CODES);
const APAO_SHIFT_CODE_SET = new Set<string>(APAO_SHIFT_CODES);

export function isRateioShiftCode(code: string): code is RateioShiftCode {
  return RATEIO_SHIFT_CODE_SET.has(code.toUpperCase());
}

export function isApaoShiftCode(code: string): code is ApaoShiftCode {
  return APAO_SHIFT_CODE_SET.has(code.toUpperCase());
}

export function asRateioShiftCode(code: string): RateioShiftCode | null {
  const upper = code.toUpperCase();
  return isRateioShiftCode(upper) ? upper : null;
}

export const RATEIO_SHIFT_ORDER = new Map<RateioShiftCode, number>(
  RATEIO_SHIFT_CODES.map((code, index) => [code, index]),
);

export const APAO_SHIFT_ORDER = new Map<ApaoShiftCode, number>(
  APAO_SHIFT_CODES.map((code, index) => [code, index]),
);
