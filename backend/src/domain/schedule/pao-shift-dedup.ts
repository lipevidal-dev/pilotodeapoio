import { PAO_COVERAGE_SHIFTS } from "../rules/constants.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { sortDedupRemovalCandidates } from "./v5-minimum-lock.js";
function shiftCodesToDedupe(ws: GenerationWorkspace): string[] {
  const parallel = listParallelShiftCodes(ws.input.shifts);
  return [...PAO_COVERAGE_SHIFTS, ...parallel.filter((c) => !PAO_COVERAGE_SHIFTS.includes(c as typeof PAO_COVERAGE_SHIFTS[number]))];
}

/** Remove PAOs extras no mesmo turno/dia — mantém o de maior senioridade (menor número). */
export function deduplicatePaoShiftCoverage(ws: GenerationWorkspace): number {
  let removed = 0;
  const byCell = new Map(
    ws.toAssignments().map((a) => [`${a.employeeUuid}|${a.date}`, a.shiftCode] as const),
  );
  for (const day of ws.days) {
    for (const code of shiftCodesToDedupe(ws)) {
      const onShift: Array<{ uuid: string; seniority: number; name: string }> = [];
      for (const c of ws.paoEmps) {
        if (byCell.get(`${c.uuid}|${day}`) === code) {
          onShift.push({
            uuid: c.uuid,
            seniority: c.employee.seniority,
            name: c.employee.name,
          });
        }
      }
      if (onShift.length <= 1) continue;
      const ctx = ws.ensureRateioContext();
      const sorted = sortDedupRemovalCandidates(ws, ctx, onShift);
      for (let i = 1; i < sorted.length; i++) {
        if (ws.unassignShift(sorted[i]!.uuid, day, { bypassT8Protection: true })) {
          removed++;
          byCell.delete(`${sorted[i]!.uuid}|${day}`);
        }
      }
    }
  }
  return removed;
}
