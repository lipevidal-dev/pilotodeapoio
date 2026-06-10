import { classifyPlanningGroup } from "./demand-planning-capacity.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { buildOperationalSummary } from "./operational-summary.js";
import { vacationDaysForPao } from "./pao-operational-priority.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";
import {
  calculateRequiredT6T7Shifts,
  workTargetForGroup,
} from "./real-schedule-targets.js";
import { computeTurnRateio } from "./real-schedule-turn-rateio.js";
import { countMotorWorkDays, countWorkdayBreakdown } from "./real-schedule-workdays.js";
import { MONTHLY_WORKDAY_TARGET, type EmployeeDiagnostic } from "./real-schedule-types.js";

function shiftIdsForCodes(codes: string[]): string[] {
  return codes.map((code) => `shift-${code.toLowerCase()}`);
}

function collectFailedAllocationReasons(
  ws: GenerationWorkspace,
  uuid: string,
  name: string,
  target: number,
  actual: number,
  turnTarget: number,
  allocatedTurns: number,
  restrictedCodes: string[],
  reasonForDeviation?: string,
): string[] {
  const reasons: string[] = [];
  if (reasonForDeviation) reasons.push(reasonForDeviation);

  if (actual < target) {
    reasons.push(`Déficit de ${target - actual} dia(s) trabalhado(s) (${actual}/${target}).`);
  }

  if (allocatedTurns < turnTarget) {
    reasons.push(`Déficit de ${turnTarget - allocatedTurns} turno(s) (${allocatedTurns}/${turnTarget}).`);
  }

  if (ws.isFullMonthNoFlight(uuid)) {
    if (restrictedCodes.includes("T8")) {
      reasons.push("Restrição T8 ativa — somente T6/T7 elegíveis para completar meta.");
    }
  }

  const vacationDays = vacationDaysForPao(ws, uuid).length;
  if (vacationDays > 0) {
    reasons.push(`${vacationDays} dia(s) de férias reduzem capacidade mensal.`);
  }

  const breakdown = countWorkdayBreakdown(ws, uuid);
  if (breakdown.voos > 0 && ws.isFullMonthNoFlight(uuid)) {
    reasons.push(`${breakdown.voos} voo(s) alocado(s) indevidamente para PAO sem voo.`);
  }
  if (breakdown.turnosT8 > 0 && restrictedCodes.includes("T8")) {
    reasons.push(`${breakdown.turnosT8} T8 alocado(s) com restrição T8 ativa.`);
  }

  const freeDays = ws.emptyDaysForPao(uuid).length;
  if (freeDays === 0) {
    reasons.push("Sem dias livres restantes no mês.");
  } else {
    reasons.push(`${freeDays} dia(s) livre(s) sem turno atribuído.`);
  }

  const gaps = ws.listCoverageGaps().length;
  if (gaps > 0) {
    reasons.push(`${gaps} furo(s) de cobertura T6/T7/T8 no mês — lacuna mantida para preservar equilíbrio.`);
  }

  for (const w of ws.noFlightWarnings) {
    if (w.employee === name) reasons.push(w.detail);
  }

  const sampleDay = ws.emptyDaysForPao(uuid)[0];
  if (sampleDay) {
    reasons.push(`Exemplo dia livre ${sampleDay}: ${ws.explainEmptyPaoDay(uuid, sampleDay)}.`);
  }

  return [...new Set(reasons)];
}

export function buildEmployeeDiagnostics(ws: GenerationWorkspace): EmployeeDiagnostic[] {
  const rateio = computeTurnRateio(ws);
  const rateioByUuid = new Map(rateio.entries.map((e) => [e.employeeUuid, e]));
  const summaryByUuid = new Map(
    buildOperationalSummary(ws).byEmployee.map((e) => [e.employeeUuid, e]),
  );

  return ws.paoEmps.map((c) => {
    const group = classifyPlanningGroup(ws, c.uuid);
    const target = workTargetForGroup(ws, c.uuid, group);
    const breakdown = countWorkdayBreakdown(ws, c.uuid);
    const rs = calculateRequiredT6T7Shifts(ws, c.uuid);
    const actual = countMotorWorkDays(ws, c.uuid);
    const op = summaryByUuid.get(c.uuid);
    const entry = rateioByUuid.get(c.uuid);

    const did = c.domainId;
    const restrictedCodes = [
      ...((ws.input.shiftRestrictions?.get(did) ?? new Set<string>()).values()),
    ].sort();
    const restrictedShiftIds = shiftIdsForCodes(restrictedCodes);

    const preferredCodes = [
      ...((ws.input.preferredShifts?.get(did) ?? new Set<string>()).values()),
    ].sort();
    const preferredShiftIds = shiftIdsForCodes(preferredCodes);
    const parallelCodes = listParallelShiftCodes(ws.input.shifts);
    const preferredParallelShiftCodes = preferredCodes.filter((code) =>
      parallelCodes.includes(code),
    );
    const assignments = ws.toAssignments().filter((a) => a.employeeUuid === c.uuid);
    const preferredShiftHitCount = assignments.filter((a) =>
      preferredCodes.includes(a.shiftCode.toUpperCase()),
    ).length;
    const parallelShiftCount = assignments.filter((a) =>
      parallelCodes.includes(a.shiftCode.toUpperCase()),
    ).length;
    let preferredShiftMissCount = 0;
    for (const code of preferredParallelShiftCodes) {
      if (!assignments.some((a) => a.shiftCode.toUpperCase() === code)) {
        preferredShiftMissCount++;
      }
    }
    const preferredShiftWarning =
      preferredShiftMissCount > 0
        ? `Preferência paralela não totalmente atendida: ${preferredParallelShiftCodes.join(", ")}.`
        : undefined;

    const turnTarget = entry?.turnTarget ?? rs.turnTarget;
    const allocatedTurns = entry?.allocatedTurns ?? rs.allocatedTurns;
    const usefulOperationalDays = entry?.usefulOperationalDays ?? rs.usefulOperationalDays;
    const turnDeviation = entry?.turnDeviation ?? rs.turnDeviation;
    const reasonForDeviation = entry?.reasonForDeviation ?? rs.reasonForDeviation;

    const failedAllocationReasons = collectFailedAllocationReasons(
      ws,
      c.uuid,
      c.employee.name,
      target,
      actual,
      turnTarget,
      allocatedTurns,
      restrictedCodes,
      reasonForDeviation,
    );

    return {
      employeeUuid: c.uuid,
      name: c.employee.name,
      group,
      turnTarget,
      allocatedTurns,
      usefulOperationalDays,
      flightCount: op?.voos ?? breakdown.voos,
      totalWorkdays: actual,
      turnDeviation,
      reasonForDeviation,
      targetWorkdays: target,
      actualWorkdays: actual,
      neededTurns: Math.max(0, MONTHLY_WORKDAY_TARGET - allocatedTurns),
      noFlightFullMonth: ws.isFullMonthNoFlight(c.uuid),
      restrictedShiftIds,
      restrictedShiftCodes: restrictedCodes,
      preferredShiftIds,
      preferredShiftCodes: preferredCodes,
      preferredParallelShiftCodes,
      parallelShiftCount,
      preferredShiftHitCount,
      preferredShiftMissCount,
      preferredShiftWarning,
      t6Count: breakdown.turnosT6,
      t7Count: breakdown.turnosT7,
      t8Count: breakdown.turnosT8,
      requiredT6T7: rs.requiredT6T7,
      failedAllocationReasons,
    };
  });
}
