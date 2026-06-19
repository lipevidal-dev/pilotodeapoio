import { addDays } from "../../rules/dates.js";
import { assignmentKey } from "../types.js";
import { GENERATOR_REST_LABELS, type GenerationWorkspace } from "./generation-workspace.js";
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

/** Reduz folgas acima do ideal (10) quando há folga de motor removível. */
export function preferIdealFolgaCount(ws: GenerationWorkspace): number {
  let trimmed = 0;
  for (const c of ws.paoEmps) {
    while (ws.countRest(c.uuid) > MIN_MONTHLY_FOLGAS) {
      if (!ws.releaseOneGeneratorFolga(c.uuid)) break;
      trimmed++;
    }
  }
  return trimmed;
}

/** Remove folgas FOLGA isoladas (monofolgas) quando não são bloqueio admin. */
export function repairIsolatedRestDays(ws: GenerationWorkspace): number {
  let fixed = 0;

  for (const c of ws.paoEmps) {
    const restDays = [
      ...new Set(
        ws.allocations
          .filter((a) => a.employeeUuid === c.uuid && a.label === "FOLGA")
          .map((a) => a.date),
      ),
    ];
    const restSet = new Set(
      ws.allocations
        .filter((a) => a.employeeUuid === c.uuid && GENERATOR_REST_LABELS.has(a.label))
        .map((a) => a.date),
    );

    for (const day of restDays) {
      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const prevRest = ws.days.includes(prev) && restSet.has(prev);
      const nextRest = ws.days.includes(next) && restSet.has(next);
      if (prevRest || nextRest) continue;
      if (ws.isLockedByAdmin(c.uuid, day)) continue;
      if (ws.releaseOneGeneratorFolga(c.uuid, day)) fixed++;
    }
  }

  return fixed;
}
