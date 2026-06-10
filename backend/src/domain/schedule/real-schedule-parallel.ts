import type { GenerationWorkspace } from "./generation-workspace.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";

export interface ParallelShiftAllocationDetail {
  days: number;
  employees: string[];
  conflicts: number;
}

export interface ParallelAllocationReport {
  parallelShiftsAllocated: number;
  byShift: Record<string, ParallelShiftAllocationDetail>;
}

export function allocateParallelShifts(ws: GenerationWorkspace): ParallelAllocationReport {
  const parallelCodes = listParallelShiftCodes(ws.input.shifts);
  const byShift: Record<string, ParallelShiftAllocationDetail> = {};
  let parallelShiftsAllocated = 0;

  for (const code of parallelCodes) {
    byShift[code] = { days: 0, employees: [], conflicts: 0 };
    const candidates = ws.paoEmps
      .filter((c) => ws.input.preferredShifts?.get(c.domainId)?.has(code))
      .sort(
        (a, b) =>
          a.employee.seniority - b.employee.seniority ||
          a.employee.name.localeCompare(b.employee.name, "pt-BR"),
      );

    const assignedEmployees = new Set<string>();

    for (const day of ws.days) {
      if (ws.hasParallelShiftOnDay(day, code)) continue;

      let placed = false;
      for (const c of candidates) {
        if (ws.tryAssignShift(c.uuid, day, code)) {
          parallelShiftsAllocated++;
          byShift[code].days++;
          assignedEmployees.add(c.uuid);
          placed = true;
          break;
        }
      }
      if (!placed && candidates.length > 0) {
        byShift[code].conflicts++;
      }
    }

    byShift[code].employees = [...assignedEmployees].map(
      (uuid) => ws.input.employees.find((e) => e.uuid === uuid)?.employee.name ?? uuid,
    );
  }

  return { parallelShiftsAllocated, byShift };
}
