import { assignmentKey } from "./types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { MIN_MONTHLY_FOLGAS } from "./real-schedule-types.js";

/** Remove turnos excedentes para abrir espaço às 10 folgas mínimas. */
export function trimShiftsForMinimumFolgas(ws: GenerationWorkspace): number {
  let removed = 0;
  const sorted = [...ws.paoEmps].sort(
    (a, b) => b.employee.seniority - a.employee.seniority,
  );

  for (const c of sorted) {
    let safety = 0;
    while (ws.countRest(c.uuid) < MIN_MONTHLY_FOLGAS && safety++ < ws.days.length) {
      const did = ws.uuidToDomain.get(c.uuid)!;
      const shiftDays = ws.days.filter((d) => {
        const code = ws.planned.get(assignmentKey(did, d));
        return code === "T6" || code === "T7";
      });

      let trimmed = false;
      for (const day of [...shiftDays].reverse()) {
        if (ws.tryRemoveShiftPreservingCoverage(c.uuid, day)) {
          removed++;
          trimmed = true;
          break;
        }
      }
      if (!trimmed) break;
    }
  }

  return removed;
}
