import type { Shift, ShiftCoverageType } from "./types.js";

export function isParallelCoverageType(coverageType?: ShiftCoverageType): boolean {
  return coverageType === "PARALLEL";
}

export function listParallelShiftCodes(shifts: Shift[]): string[] {
  return shifts.filter((s) => isParallelCoverageType(s.coverageType)).map((s) => s.code.toUpperCase());
}

export function listRequiredCoverageShiftCodes(shifts: Shift[]): string[] {
  return shifts
    .filter((s) => !isParallelCoverageType(s.coverageType))
    .map((s) => s.code.toUpperCase());
}
