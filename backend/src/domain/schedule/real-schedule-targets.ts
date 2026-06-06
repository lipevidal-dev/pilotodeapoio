import { MIN_SHIFTS_FULL_NO_FLIGHT_MONTH } from "../employee/restrictions.js";
import { classifyPlanningGroup } from "./demand-planning-capacity.js";
import type { IndividualTarget } from "./demand-planning-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  MIN_MONTHLY_FOLGAS,
  MONTHLY_WORKDAY_TARGET,
  type RequiredShiftsResult,
} from "./real-schedule-types.js";
import { countWorkdayBreakdown } from "./real-schedule-workdays.js";
import { vacationPatternWorkTarget } from "./real-schedule-vacation-pattern.js";
import { isVacationDay, vacationDaysForPao } from "./pao-operational-priority.js";
import type { ValidationIssue } from "./types.js";

export function workTargetForGroup(
  ws: GenerationWorkspace,
  uuid: string,
  group: ReturnType<typeof classifyPlanningGroup>,
): number {
  if (group === "FULL_NO_FLIGHT") return MONTHLY_WORKDAY_TARGET;
  if (group === "VACATION") {
    const vacationCount = vacationDaysForPao(ws, uuid).length;
    const available = Math.max(0, ws.days.length - vacationCount);
    const pattern = vacationPatternWorkTarget(available);
    const folgaRoom = Math.max(0, available - MIN_MONTHLY_FOLGAS);
    return Math.min(pattern, folgaRoom);
  }
  return MONTHLY_WORKDAY_TARGET;
}

/** TURNOS_NECESSÁRIOS = meta − voos − cadastros úteis − T8 já alocado. */
export function calculateRequiredT6T7Shifts(
  ws: GenerationWorkspace,
  uuid: string,
): RequiredShiftsResult {
  const emp = ws.paoEmps.find((p) => p.uuid === uuid)!;
  const group = classifyPlanningGroup(ws, uuid);
  const workTarget = workTargetForGroup(ws, uuid, group);
  const breakdown = countWorkdayBreakdown(ws, uuid);
  const consumed =
    breakdown.voos +
    breakdown.cursos +
    breakdown.simuladores +
    breakdown.cma +
    breakdown.outros +
    breakdown.turnosT8;

  const vacationDays = vacationDaysForPao(ws, uuid).length;
  const maxAdditionalT6T7 = Math.max(
    0,
    ws.days.length -
      MIN_MONTHLY_FOLGAS -
      vacationDays -
      breakdown.turnosT8 -
      breakdown.voos -
      breakdown.cursos -
      breakdown.simuladores -
      breakdown.cma -
      breakdown.outros -
      breakdown.turnosT6 -
      breakdown.turnosT7,
  );

  let requiredT6T7 = Math.min(workTarget - consumed, maxAdditionalT6T7);
  let note: string | undefined;
  if (workTarget - consumed < 0) {
    note = `Meta flexível: déficit negativo (${requiredT6T7}) — usando 0 turnos T6/T7 adicionais.`;
    requiredT6T7 = 0;
  }

  return {
    employeeUuid: uuid,
    name: emp.employee.name,
    group,
    workTarget,
    requiredT6T7,
    breakdown,
    note,
  };
}

export function computeRealMotorTargets(ws: GenerationWorkspace): {
  required: RequiredShiftsResult[];
  targets: IndividualTarget[];
  warnings: ValidationIssue[];
} {
  const warnings: ValidationIssue[] = [];
  const sorted = [...ws.paoEmps].sort(
    (a, b) => a.employee.seniority - b.employee.seniority,
  );
  const required: RequiredShiftsResult[] = [];
  const targets: IndividualTarget[] = [];

  for (const emp of sorted) {
    const rs = calculateRequiredT6T7Shifts(ws, emp.uuid);
    required.push(rs);
    if (rs.note) {
      warnings.push({
        severity: "MÉDIA",
        level: "WARNING",
        type: "META TURNOS",
        date: "",
        employee: rs.name,
        detail: rs.note,
      });
    }
    if (rs.group === "FULL_NO_FLIGHT" && rs.requiredT6T7 + rs.breakdown.turnosT6 + rs.breakdown.turnosT7 < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
      const turnosMeta = rs.requiredT6T7 + rs.breakdown.turnosT6 + rs.breakdown.turnosT7;
      if (turnosMeta < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
        warnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "RESTRIÇÃO VOO MÊS INTEIRO",
          date: "",
          employee: rs.name,
          detail: `Motor real: meta ${turnosMeta}/${MIN_SHIFTS_FULL_NO_FLIGHT_MONTH} turnos para mês sem voo.`,
        });
      }
    }
    targets.push({
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group: rs.group,
      seniority: emp.employee.seniority,
      target: rs.requiredT6T7,
      capacity: rs.requiredT6T7,
    });
  }

  return {
    required,
    targets: targets.sort(
      (a, b) =>
        groupOrder(a.group) - groupOrder(b.group) ||
        a.seniority - b.seniority,
    ),
    warnings,
  };
}

function groupOrder(group: IndividualTarget["group"]): number {
  if (group === "FULL_NO_FLIGHT") return 0;
  if (group === "VACATION") return 1;
  return 2;
}

/** Dias disponíveis (fora de férias) para PAO com férias quinzenais. */
export function availableDaysOutsideVacation(ws: GenerationWorkspace, uuid: string): string[] {
  return ws.days.filter((d) => !isVacationDay(ws, uuid, d));
}
