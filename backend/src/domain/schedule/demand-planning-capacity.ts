import { IDEAL_PAO_REST_COUNT } from "../rules/constants.js";
import {
  hasVacationInMonth,
  vacationDaysForPao,
} from "./pao-operational-priority.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type {
  CapacitySummary,
  EmployeeCapacity,
  PlanningGroup,
} from "./demand-planning-types.js";
import {
  FULL_NO_FLIGHT_TARGET,
  NORMAL_CAPACITY_30,
  NORMAL_CAPACITY_31,
  VACATION_TARGET_30,
  VACATION_TARGET_31,
} from "./demand-planning-types.js";

export function classifyPlanningGroup(ws: GenerationWorkspace, uuid: string): PlanningGroup {
  if (ws.isFullMonthNoFlight(uuid)) return "FULL_NO_FLIGHT";
  if (hasVacationInMonth(ws, uuid)) return "VACATION";
  return "NORMAL";
}

function normalBaseCapacity(daysInMonth: number): number {
  return daysInMonth >= 31 ? NORMAL_CAPACITY_31 : NORMAL_CAPACITY_30;
}

/** Etapa 2 — Capacidade operacional por PAO. */
export function calculateEmployeeCapacity(
  ws: GenerationWorkspace,
  uuid: string,
): EmployeeCapacity {
  const emp = ws.paoEmps.find((p) => p.uuid === uuid)!;
  const group = classifyPlanningGroup(ws, uuid);
  const days = ws.days.length;
  const vacationDays = vacationDaysForPao(ws, uuid).length;

  if (group === "FULL_NO_FLIGHT") {
    return {
      employeeUuid: uuid,
      name: emp.employee.name,
      group,
      capacity: FULL_NO_FLIGHT_TARGET,
      adjusted: true,
      detail: "Meta fixa — mês inteiro sem voo (20 turnos)",
    };
  }

  if (group === "VACATION") {
    const cap = days >= 31 ? VACATION_TARGET_31 : VACATION_TARGET_30;
    return {
      employeeUuid: uuid,
      name: emp.employee.name,
      group,
      capacity: cap,
      adjusted: true,
      detail: `Férias no mês — padrão 3x2 (${cap} turnos)`,
    };
  }

  const base = normalBaseCapacity(days);
  const restrictedDays = ws.days.filter((d) => ws.isDayBlockedForShift(uuid, d)).length;
  const capacity = Math.max(0, Math.min(base, days - IDEAL_PAO_REST_COUNT - vacationDays));
  const adjusted = restrictedDays > vacationDays || capacity < base;

  return {
    employeeUuid: uuid,
    name: emp.employee.name,
    group: "NORMAL",
    capacity,
    adjusted,
    detail: adjusted
      ? `Capacidade ajustada (${capacity}) — bloqueios/restrições`
      : `Capacidade padrão (${capacity})`,
  };
}

export function calculateCapacitySummary(ws: GenerationWorkspace): CapacitySummary {
  const byEmployee = ws.paoEmps.map((p) => calculateEmployeeCapacity(ws, p.uuid));
  return {
    byEmployee,
    totalCapacity: byEmployee.reduce((n, e) => n + e.capacity, 0),
  };
}
