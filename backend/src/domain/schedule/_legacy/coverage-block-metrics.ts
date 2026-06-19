import { addDays } from "../../rules/dates.js";
import type { GeneratedAssignment } from "../generation-types.js";
import type { T6T7ShiftCode } from "./coverage-block-config.js";

export interface ShiftBlockCoverageReport {
  shiftCode: T6T7ShiftCode;
  blockCount: number;
  averageBlockSize: number;
  unitCoverageCount: number;
  blockSizes: number[];
}

export interface T6T7BlockCoverageSummary {
  T6: ShiftBlockCoverageReport;
  T7: ShiftBlockCoverageReport;
  unitCoverageTotal: number;
}

function blocksForEmployeeShift(
  dates: string[],
  monthDays: string[],
): number[] {
  if (dates.length === 0) return [];
  const dayIndex = new Map(monthDays.map((d, i) => [d, i]));
  const sorted = [...dates].sort((a, b) => (dayIndex.get(a) ?? 0) - (dayIndex.get(b) ?? 0));
  const blocks: number[] = [];
  let current = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (addDays(prev, 1) === cur) {
      current++;
    } else {
      blocks.push(current);
      current = 1;
    }
  }
  blocks.push(current);
  return blocks;
}

export function analyzeT6T7BlockCoverage(
  assignments: GeneratedAssignment[],
  monthDays: string[],
): T6T7BlockCoverageSummary {
  const reports: Record<T6T7ShiftCode, ShiftBlockCoverageReport> = {
    T6: { shiftCode: "T6", blockCount: 0, averageBlockSize: 0, unitCoverageCount: 0, blockSizes: [] },
    T7: { shiftCode: "T7", blockCount: 0, averageBlockSize: 0, unitCoverageCount: 0, blockSizes: [] },
  };

  for (const code of ["T6", "T7"] as const) {
    const byEmployee = new Map<string, string[]>();
    for (const a of assignments) {
      if (a.shiftCode !== code) continue;
      const list = byEmployee.get(a.employeeUuid) ?? [];
      list.push(a.date);
      byEmployee.set(a.employeeUuid, list);
    }

    const allBlocks: number[] = [];
    for (const dates of byEmployee.values()) {
      allBlocks.push(...blocksForEmployeeShift(dates, monthDays));
    }

    const blockCount = allBlocks.length;
    const unitCoverageCount = allBlocks.filter((n) => n === 1).length;
    const averageBlockSize =
      blockCount > 0 ? allBlocks.reduce((sum, n) => sum + n, 0) / blockCount : 0;

    reports[code] = {
      shiftCode: code,
      blockCount,
      averageBlockSize: Math.round(averageBlockSize * 100) / 100,
      unitCoverageCount,
      blockSizes: allBlocks,
    };
  }

  return {
    T6: reports.T6,
    T7: reports.T7,
    unitCoverageTotal: reports.T6.unitCoverageCount + reports.T7.unitCoverageCount,
  };
}
