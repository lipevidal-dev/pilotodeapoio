import type { Shift, ShiftCoverageType } from '../models/api.models';

export function isParallelCoverageType(coverageType?: ShiftCoverageType): boolean {
  return coverageType === 'PARALLEL';
}

export function listParallelShiftCodes(shifts: Shift[] | undefined): Set<string> {
  const codes = new Set<string>();
  for (const shift of shifts ?? []) {
    if (isParallelCoverageType(shift.coverageType)) {
      codes.add(shift.code.toUpperCase());
    }
  }
  return codes;
}
