import { classifyPlanningGroup } from "./demand-planning-capacity.js";
import type { IndividualTarget } from "./demand-planning-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import {
  MIN_MONTHLY_FOLGAS,
  MONTHLY_WORKDAY_TARGET,
  type RequiredShiftsResult,
} from "./real-schedule-types.js";
import {
  computeTurnRateio,
  type TurnRateioEntry,
} from "./real-schedule-turn-rateio.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
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

/** Alvo de turnos T6/T7 a materializar após rateio por turnos alocados. */
export function calculateRequiredT6T7Shifts(
  ws: GenerationWorkspace,
  uuid: string,
): RequiredShiftsResult {
  const rateio = computeTurnRateio(ws);
  const entry = rateio.entries.find((e) => e.employeeUuid === uuid);
  const breakdown = countWorkdayBreakdown(ws, uuid);

  if (!entry) {
    const emp = ws.paoEmps.find((p) => p.uuid === uuid)!;
    return {
      employeeUuid: uuid,
      name: emp.employee.name,
      group: "NORMAL",
      workTarget: MONTHLY_WORKDAY_TARGET,
      turnTarget: 0,
      usefulOperationalDays: 0,
      allocatedTurns: countRateioTurns(ws, uuid),
      turnDeviation: 0,
      requiredT6T7: 0,
      breakdown,
    };
  }

  const vacationDays = vacationDaysForPao(ws, uuid).length;
  const maxAdditionalT6T7 = Math.max(
    0,
    ws.days.length -
      MIN_MONTHLY_FOLGAS -
      vacationDays -
      breakdown.turnosT8 -
      breakdown.turnosT6 -
      breakdown.turnosT7,
  );

  let requiredT6T7 = Math.min(entry.requiredT6T7, maxAdditionalT6T7);
  let note: string | undefined;
  if (entry.requiredT6T7 < 0) {
    note = `Meta flexível: déficit negativo — usando 0 turnos T6/T7 adicionais.`;
    requiredT6T7 = 0;
  }

  return {
    employeeUuid: uuid,
    name: entry.name,
    group: entry.group,
    workTarget: workTargetForGroup(ws, uuid, entry.group),
    turnTarget: entry.turnTarget,
    usefulOperationalDays: entry.usefulOperationalDays,
    allocatedTurns: entry.allocatedTurns,
    turnDeviation: entry.turnDeviation,
    reasonForDeviation: entry.reasonForDeviation,
    requiredT6T7,
    breakdown,
    note,
  };
}

export function computeRealMotorTargets(ws: GenerationWorkspace): {
  required: RequiredShiftsResult[];
  targets: IndividualTarget[];
  turnRateio: TurnRateioEntry[];
  turnosRateio: number;
  metaTurnosNormal: number;
  warnings: ValidationIssue[];
} {
  const rateio = computeTurnRateio(ws);
  const required = rateio.entries.map((entry) => {
    const rs = calculateRequiredT6T7Shifts(ws, entry.employeeUuid);
    return rs;
  });

  return {
    required,
    targets: rateio.targets,
    turnRateio: rateio.entries,
    turnosRateio: rateio.turnosRateio,
    metaTurnosNormal: rateio.metaTurnosNormal,
    warnings: rateio.warnings,
  };
}

/** Dias disponíveis (fora de férias) para PAO com férias quinzenais. */
export function availableDaysOutsideVacation(ws: GenerationWorkspace, uuid: string): string[] {
  return ws.days.filter((d) => !isVacationDay(ws, uuid, d));
}
