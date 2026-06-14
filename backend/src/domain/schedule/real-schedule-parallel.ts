import type { GenerationWorkspace } from "./generation-workspace.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";
import { assignmentKey } from "./types.js";
import { addDays } from "../rules/dates.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
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

function allocatedForParallelCap(
  ws: GenerationWorkspace,
  uuid: string,
  code: string,
  entry: TurnRateioEntry,
): number {
  if (isParallelOnlyPreferredPao(ws, uuid)) {
    return ws.toAssignments().filter((a) => a.employeeUuid === uuid && a.shiftCode === code).length;
  }
  return entry.allocatedTurns;
}

/** Dias livres agrupados em sequências consecutivas (blocos de T9). */
function emptyDayRuns(ws: GenerationWorkspace, uuid: string, did: number): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];

  for (const day of ws.days) {
    if (ws.planned.has(assignmentKey(did, day)) || ws.isDayBlockedForShift(uuid, day)) {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
      continue;
    }
    if (current.length === 0 || addDays(current[current.length - 1]!, 1) === day) {
      current.push(day);
    } else {
      runs.push(current);
      current = [day];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs.sort((a, b) => b.length - a.length);
}

/** Preenche T9/paralelos em dias livres até assignedShiftCount ≈ turnTarget. */
export function allocateParallelShifts(ws: GenerationWorkspace): ParallelAllocationReport {
  const parallelCodes = listParallelShiftCodes(ws.input.shifts);
  const byShift: Record<string, ParallelShiftAllocationDetail> = {};
  let parallelShiftsAllocated = 0;

  const rateio = computeTurnRateio(ws);
  const entryByUuid = new Map(rateio.entries.map((e) => [e.employeeUuid, { ...e }]));

  for (const code of parallelCodes) {
    byShift[code] = { days: 0, employees: [], conflicts: 0 };
    const assignedEmployees = new Set<string>();

    const eligible = ws.paoEmps
      .filter((c) => ws.input.preferredShifts?.get(c.domainId)?.has(code))
      .sort((a, b) => {
        const ea = entryByUuid.get(a.uuid)!;
        const eb = entryByUuid.get(b.uuid)!;
        if (ea.turnDeviation !== eb.turnDeviation) return ea.turnDeviation - eb.turnDeviation;
        return a.employee.seniority - b.employee.seniority;
      });

    for (const c of eligible) {
      const entry = entryByUuid.get(c.uuid);
      if (!entry) continue;

      const did = c.domainId;
      let progress = false;
      const runs = emptyDayRuns(ws, c.uuid, did);

      for (const run of runs) {
        for (const day of run) {
          const allocated = allocatedForParallelCap(ws, c.uuid, code, entry);
          if (allocated >= entry.turnTarget) break;
          if (ws.planned.has(assignmentKey(did, day))) continue;
          if (ws.hasParallelShiftOnDay(day, code)) continue;

          if (ws.tryAssignShift(c.uuid, day, code)) {
            parallelShiftsAllocated++;
            byShift[code].days++;
            assignedEmployees.add(c.uuid);
            refreshEntry(entry, ws, c.uuid);
            progress = true;
          }
        }
        if (allocatedForParallelCap(ws, c.uuid, code, entry) >= entry.turnTarget) break;
      }

      if (!progress && allocatedForParallelCap(ws, c.uuid, code, entry) < entry.turnTarget) {
        byShift[code].conflicts++;
      }
    }

    byShift[code].employees = [...assignedEmployees].map(
      (uuid) => ws.input.employees.find((e) => e.uuid === uuid)?.employee.name ?? uuid,
    );
  }

  return { parallelShiftsAllocated, byShift };
}
