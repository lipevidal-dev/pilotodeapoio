import type { GenerationWorkspace } from "./generation-workspace.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";
import {
  computeTurnRateio,
  countAllocatedTurns,
  type TurnRateioEntry,
} from "./real-schedule-turn-rateio.js";

export interface ParallelShiftAllocationDetail {
  days: number;
  employees: string[];
  conflicts: number;
}

export interface ParallelAllocationReport {
  parallelShiftsAllocated: number;
  byShift: Record<string, ParallelShiftAllocationDetail>;
}

function refreshEntry(entry: TurnRateioEntry, ws: GenerationWorkspace, uuid: string): void {
  entry.allocatedTurns = countAllocatedTurns(ws, uuid);
  entry.turnDeviation = entry.allocatedTurns - entry.turnTarget;
}

export function allocateParallelShifts(ws: GenerationWorkspace): ParallelAllocationReport {
  const parallelCodes = listParallelShiftCodes(ws.input.shifts);
  const byShift: Record<string, ParallelShiftAllocationDetail> = {};
  let parallelShiftsAllocated = 0;

  const rateio = computeTurnRateio(ws);
  const entryByUuid = new Map(rateio.entries.map((e) => [e.employeeUuid, { ...e }]));

  for (const code of parallelCodes) {
    byShift[code] = { days: 0, employees: [], conflicts: 0 };
    const assignedEmployees = new Set<string>();

    for (const day of ws.days) {
      if (ws.hasParallelShiftOnDay(day, code)) continue;

      const candidates = ws.paoEmps
        .filter((c) => ws.input.preferredShifts?.get(c.domainId)?.has(code))
        .filter((c) => {
          const entry = entryByUuid.get(c.uuid);
          return entry != null && entry.allocatedTurns < entry.turnTarget;
        })
        .sort((a, b) => {
          const ea = entryByUuid.get(a.uuid)!;
          const eb = entryByUuid.get(b.uuid)!;
          if (ea.turnDeviation !== eb.turnDeviation) return ea.turnDeviation - eb.turnDeviation;
          return a.employee.seniority - b.employee.seniority;
        });

      let placed = false;
      for (const c of candidates) {
        if (ws.tryAssignShift(c.uuid, day, code)) {
          parallelShiftsAllocated++;
          byShift[code].days++;
          assignedEmployees.add(c.uuid);
          const entry = entryByUuid.get(c.uuid);
          if (entry) refreshEntry(entry, ws, c.uuid);
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
