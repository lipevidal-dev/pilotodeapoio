export const T6_BLOCK_MIN = 3;
export const T6_BLOCK_MAX = 5;
export const T7_BLOCK_MIN = 3;
export const T7_BLOCK_MAX = 5;

export type T6T7ShiftCode = "T6" | "T7";

export function blockLimitsForShift(code: T6T7ShiftCode): { min: number; max: number } {
  if (code === "T6") {
    return { min: T6_BLOCK_MIN, max: T6_BLOCK_MAX };
  }
  return { min: T7_BLOCK_MIN, max: T7_BLOCK_MAX };
}
