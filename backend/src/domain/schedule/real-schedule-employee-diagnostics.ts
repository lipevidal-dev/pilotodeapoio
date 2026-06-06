import { classifyPlanningGroup } from "./demand-planning-capacity.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { buildOperationalSummary } from "./operational-summary.js";
import { countOperationalShifts } from "./pao-operational-shifts.js";
import { vacationDaysForPao } from "./pao-operational-priority.js";
import {
  calculateRequiredT6T7Shifts,
  workTargetForGroup,
} from "./real-schedule-targets.js";
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
  restrictedCodes: string[],
): string[] {
  const reasons: string[] = [];
  if (actual >= target) return reasons;

  const deficit = target - actual;
  reasons.push(`Déficit de ${deficit} dia(s) trabalhado(s) (${actual}/${target}).`);

  if (ws.isFullMonthNoFlight(uuid)) {
    const turnos = countOperationalShifts(ws, uuid);
    reasons.push(`PAO mês inteiro sem voo: ${turnos} turnos operacionais alocados.`);
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
    reasons.push(`${gaps} furo(s) de cobertura T6/T7/T8 no mês limitam realocação.`);
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

    const did = c.domainId;
    const restrictedCodes = [
      ...((ws.input.shiftRestrictions?.get(did) ?? new Set<string>()).values()),
    ].sort();
    const restrictedShiftIds = shiftIdsForCodes(restrictedCodes);

    const usefulOperationalDays =
      breakdown.turnosT6 +
      breakdown.turnosT7 +
      breakdown.turnosT8 +
      breakdown.voos +
      breakdown.cursos +
      breakdown.simuladores +
      breakdown.cma +
      breakdown.outros;

    const failedAllocationReasons = collectFailedAllocationReasons(
      ws,
      c.uuid,
      c.employee.name,
      target,
      actual,
      restrictedCodes,
    );

    return {
      employeeUuid: c.uuid,
      name: c.employee.name,
      targetWorkdays: target,
      actualWorkdays: actual,
      neededTurns: Math.max(0, MONTHLY_WORKDAY_TARGET - countOperationalShifts(ws, c.uuid)),
      noFlightFullMonth: ws.isFullMonthNoFlight(c.uuid),
      restrictedShiftIds,
      restrictedShiftCodes: restrictedCodes,
      t6Count: breakdown.turnosT6,
      t7Count: breakdown.turnosT7,
      t8Count: breakdown.turnosT8,
      flightCount: op?.voos ?? breakdown.voos,
      usefulOperationalDays,
      requiredT6T7: rs.requiredT6T7,
      failedAllocationReasons,
    };
  });
}
