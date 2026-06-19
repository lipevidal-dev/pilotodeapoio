import { isPaoDayDisponivel } from "./available-for-flight.js";
import { classifyPlanningGroup } from "./demand-planning-capacity.js";
import type { GeneratedAllocation } from "../generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { countWorkedDays } from "./real-schedule-workdays.js";
import { workTargetForGroup } from "./real-schedule-targets.js";

/** Voos como preenchimento de buracos — completam déficit de dias trabalhados. */
export function allocateFlightsForWorkdayDeficit(ws: GenerationWorkspace): GeneratedAllocation[] {
  const created: GeneratedAllocation[] = [];
  const sorted = [...ws.paoEmps].sort(
    (a, b) => a.employee.seniority - b.employee.seniority,
  );

  for (const c of sorted) {
    if (ws.isFullMonthNoFlight(c.uuid)) continue;

    const group = classifyPlanningGroup(ws, c.uuid);
    const target = workTargetForGroup(ws, c.uuid, group);
    const workDays = countWorkedDays(ws, c.uuid);
    const deficit = target - workDays;
    if (deficit <= 0) continue;

    let added = 0;
    for (const day of ws.days) {
      if (added >= deficit) break;
      if (ws.isNoFlightDay(c.uuid, day)) continue;
      if (!isPaoDayDisponivel(ws, c.uuid, day)) continue;
      if (ws.isDayBlockedForShift(c.uuid, day)) continue;

      ws.lockDay(c.uuid, day, "VOO");
      created.push({ employeeUuid: c.uuid, date: day, label: "VOO" });
      added++;
    }
  }

  return created;
}
