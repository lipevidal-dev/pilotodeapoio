import { MIN_SHIFTS_FULL_NO_FLIGHT_MONTH } from "../../employee/restrictions.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { calculateCapacitySummary, classifyPlanningGroup } from "./demand-planning-capacity.js";
import type { IndividualTarget, OperationalDemand } from "./demand-planning-types.js";
import {
  FULL_NO_FLIGHT_TARGET,
  VACATION_TARGET_30,
  VACATION_TARGET_31,
} from "./demand-planning-types.js";

/** Etapa 3 — Metas individuais por grupo operacional. */
export function computeIndividualTargets(
  ws: GenerationWorkspace,
  demand: OperationalDemand,
): IndividualTarget[] {
  const capacity = calculateCapacitySummary(ws);
  const capByUuid = new Map(capacity.byEmployee.map((c) => [c.employeeUuid, c]));
  const targets: IndividualTarget[] = [];
  let reservedDemand = 0;

  const sorted = [...ws.paoEmps].sort(
    (a, b) => a.employee.seniority - b.employee.seniority,
  );

  for (const emp of sorted) {
    const group = classifyPlanningGroup(ws, emp.uuid);
    if (group !== "FULL_NO_FLIGHT") continue;
    const cap = capByUuid.get(emp.uuid)!;
    const target = Math.min(FULL_NO_FLIGHT_TARGET, cap.capacity);
    targets.push({
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group,
      seniority: emp.employee.seniority,
      target,
      capacity: cap.capacity,
    });
    reservedDemand += target;
  }

  for (const emp of sorted) {
    const group = classifyPlanningGroup(ws, emp.uuid);
    if (group !== "VACATION") continue;
    const cap = capByUuid.get(emp.uuid)!;
    const fixed = ws.days.length >= 31 ? VACATION_TARGET_31 : VACATION_TARGET_30;
    const target = Math.min(fixed, cap.capacity);
    targets.push({
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group,
      seniority: emp.employee.seniority,
      target,
      capacity: cap.capacity,
    });
    reservedDemand += target;
  }

  const normals = sorted.filter((e) => classifyPlanningGroup(ws, e.uuid) === "NORMAL");
  const remaining = Math.max(0, demand.totalDemand - reservedDemand);
  const baseShare = normals.length > 0 ? Math.floor(remaining / normals.length) : 0;
  let remainder = normals.length > 0 ? remaining % normals.length : 0;

  for (const emp of normals) {
    const cap = capByUuid.get(emp.uuid)!;
    let target = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    target = Math.min(target, cap.capacity);
    targets.push({
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group: "NORMAL",
      seniority: emp.employee.seniority,
      target,
      capacity: cap.capacity,
    });
  }

  for (const t of targets.filter((x) => x.group === "FULL_NO_FLIGHT")) {
    if (t.target < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
      ws.noFlightWarnings.push({
        severity: "MÉDIA",
        level: "WARNING",
        type: "RESTRIÇÃO VOO MÊS INTEIRO",
        date: "",
        employee: t.name,
        detail: `Planejamento: meta ${t.target}/${MIN_SHIFTS_FULL_NO_FLIGHT_MONTH} turnos para mês sem voo.`,
      });
    }
  }

  return targets.sort(
    (a, b) =>
      groupOrder(a.group) - groupOrder(b.group) ||
      a.seniority - b.seniority,
  );
}

function groupOrder(group: IndividualTarget["group"]): number {
  if (group === "FULL_NO_FLIGHT") return 0;
  if (group === "VACATION") return 1;
  return 2;
}
