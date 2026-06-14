import {
  calculateCapacitySummary,
  classifyPlanningGroup,
} from "./demand-planning-capacity.js";
import { calculateTurnRateioDemand } from "./demand-planning-demand.js";
import type { IndividualTarget, OperationalDemand, PlanningGroup } from "./demand-planning-types.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";
import {
  minTurnDeficit,
} from "./schedule-rateio-context.js";
import { countWorkdayBreakdown } from "./real-schedule-workdays.js";
import { countAllocatedOperationalTurns } from "./pao-rateio-shifts.js";
import { buildScheduleRateioContext } from "./schedule-rateio-context.js";

export interface TurnRateioEntry {
  employeeUuid: string;
  name: string;
  group: PlanningGroup;
  seniority: number;
  turnTarget: number;
  /** Informativo — cadastros não alteram meta de turnos. */
  usefulOperationalDays: number;
  allocatedTurns: number;
  requiredT6T7: number;
  metaTurnosNormal?: number;
  turnDeviation: number;
  reasonForDeviation?: string;
}

export interface TurnRateioResult {
  demand: OperationalDemand;
  turnosRateio: number;
  metaTurnosNormal: number;
  entries: TurnRateioEntry[];
  targets: IndividualTarget[];
  warnings: ValidationIssue[];
}

/** Informativo — SIM/CRS/CMA/OUTRO não entram no rateio de turnos. */
export function countUsefulOperationalDays(ws: GenerationWorkspace, uuid: string): number {
  const b = countWorkdayBreakdown(ws, uuid);
  return b.cursos + b.simuladores + b.cma + b.outros;
}

/** Turnos alocados para fairness (T6/T7/T8/T9/…). */
export function countAllocatedTurns(ws: GenerationWorkspace, uuid: string): number {
  return countAllocatedOperationalTurns(ws, uuid);
}

function distributeIntegerTargets(employeeUuids: string[], totalPool: number): Map<string, number> {
  const out = new Map<string, number>();
  if (employeeUuids.length === 0 || totalPool <= 0) return out;

  const meta = totalPool / employeeUuids.length;
  const floats = employeeUuids.map((uuid) => {
    const raw = meta;
    const floor = Math.max(0, Math.floor(raw));
    return { uuid, raw, floor, frac: raw - floor };
  });

  let assigned = floats.reduce((n, f) => n + f.floor, 0);
  let remainder = totalPool - assigned;

  floats.sort((a, b) => {
    const fracDiff = b.frac - a.frac;
    if (fracDiff !== 0) return fracDiff;
    return a.uuid.localeCompare(b.uuid);
  });

  for (const f of floats) {
    out.set(f.uuid, f.floor);
  }
  for (let i = 0; i < floats.length && remainder > 0; i++) {
    const uuid = floats[i]!.uuid;
    out.set(uuid, (out.get(uuid) ?? 0) + 1);
    remainder--;
  }

  return out;
}

function deviationReason(entry: TurnRateioEntry): string | undefined {
  if (entry.turnDeviation === 0) return undefined;
  if (entry.turnDeviation < 0) {
    return `Abaixo da meta de turnos (${entry.allocatedTurns}/${entry.turnTarget}).`;
  }
  return `Acima da meta de turnos (${entry.allocatedTurns}/${entry.turnTarget}).`;
}

/**
 * Rateio por turnos alocados — média = demanda REQUIRED ÷ PAOs.
 * Cadastros operacionais e dias trabalhados não alteram a meta.
 */
export function computeTurnRateio(ws: GenerationWorkspace): TurnRateioResult {
  const demand = calculateTurnRateioDemand(ws.days.length, ws.input.shifts);
  const capacity = calculateCapacitySummary(ws);
  const capByUuid = new Map(capacity.byEmployee.map((c) => [c.employeeUuid, c]));
  const warnings: ValidationIssue[] = [];
  const entries: TurnRateioEntry[] = [];
  const targets: IndividualTarget[] = [];

  const ctx = ws.rateioContext ?? buildScheduleRateioContext(ws);
  const sorted = [...ws.paoEmps].sort((a, b) => a.employee.seniority - b.employee.seniority);
  const mainPoolUuids = sorted
    .filter((e) => ctx.mainPoolEmployeeIds.has(e.uuid))
    .map((e) => e.uuid);
  const turnosRateio = demand.totalDemand;
  const metaTurnosNormal =
    mainPoolUuids.length > 0 ? turnosRateio / mainPoolUuids.length : 0;
  const turnTargets = distributeIntegerTargets(mainPoolUuids, turnosRateio);

  for (const emp of sorted) {
    if (!ctx.mainPoolEmployeeIds.has(emp.uuid)) {
      turnTargets.set(
        emp.uuid,
        Math.round(ctx.targetTurnCounts.get(emp.uuid) ?? metaTurnosNormal),
      );
    }
  }

  for (const emp of sorted) {
    const group = classifyPlanningGroup(ws, emp.uuid);
    const useful = countUsefulOperationalDays(ws, emp.uuid);
    const allocated =
      ctx.currentTurnCounts.get(emp.uuid) ?? countAllocatedTurns(ws, emp.uuid);
    const cap = capByUuid.get(emp.uuid)!;
    const turnTarget = turnTargets.get(emp.uuid) ?? 0;
    const maxTurns = ctx.maxTurnCounts.get(emp.uuid);
    const requiredT6T7 = Math.max(0, turnTarget - allocated);

    const entry: TurnRateioEntry = {
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group,
      seniority: emp.employee.seniority,
      turnTarget,
      usefulOperationalDays: useful,
      allocatedTurns: allocated,
      requiredT6T7,
      metaTurnosNormal,
      turnDeviation: allocated - turnTarget,
    };
    if (maxTurns != null && allocated > maxTurns) {
      entry.reasonForDeviation = `Acima do máximo de rateio (${allocated}/${maxTurns}).`;
    } else {
      entry.reasonForDeviation = deviationReason(entry);
    }
    entries.push(entry);
    targets.push({
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group,
      seniority: emp.employee.seniority,
      target: Math.min(requiredT6T7, cap.capacity),
      capacity: cap.capacity,
    });
  }

  return {
    demand,
    turnosRateio,
    metaTurnosNormal,
    entries: entries.sort(
      (a, b) =>
        groupOrder(a.group) - groupOrder(b.group) ||
        a.seniority - b.seniority,
    ),
    targets: targets.sort(
      (a, b) =>
        groupOrder(a.group) - groupOrder(b.group) ||
        a.seniority - b.seniority,
    ),
    warnings,
  };
}

function groupOrder(group: PlanningGroup): number {
  if (group === "FULL_NO_FLIGHT") return 0;
  if (group === "VACATION") return 1;
  return 2;
}

/** Ordena PAOs pelo desvio de turnos (assignedShiftCount vs meta). */
export function sortPaoByAssignedTurnBalance(
  ws: GenerationWorkspace,
  entries?: TurnRateioEntry[],
): GenerationInputEmployee[] {
  const rateioEntries = entries ?? computeTurnRateio(ws).entries;
  const byUuid = new Map(rateioEntries.map((e) => [e.employeeUuid, e]));
  return [...ws.paoEmps].sort((a, b) => {
    const devA = byUuid.get(a.uuid)?.turnDeviation ?? 0;
    const devB = byUuid.get(b.uuid)?.turnDeviation ?? 0;
    if (devA !== devB) return devA - devB;
    return a.employee.seniority - b.employee.seniority;
  });
}

/** Ordena candidatos para cobertura — prioriza abaixo do mínimo/meta, sem excluir PAOs no max. */
export function sortPaoForCoverageCandidates(
  ws: GenerationWorkspace,
  _dayIndex: number,
  entries?: TurnRateioEntry[],
): GenerationInputEmployee[] {
  const ctx = ws.rateioContext;
  const rateioEntries = entries ?? computeTurnRateio(ws).entries;
  const byUuid = new Map(rateioEntries.map((e) => [e.employeeUuid, e]));

  const coverageTier = (uuid: string): number => {
    if (!ctx) {
      const dev = byUuid.get(uuid)?.turnDeviation ?? 0;
      return dev < 0 ? 0 : 1;
    }
    const cur = ctx.currentTurnCounts.get(uuid) ?? 0;
    const min = ctx.minTurnCounts.get(uuid) ?? 0;
    const max = ctx.maxTurnCounts.get(uuid);
    if (cur < min) return 0;
    const dev = byUuid.get(uuid)?.turnDeviation ?? 0;
    if (dev < 0) return 1;
    if (max == null || cur < max) return 2;
    return 3;
  };

  return [...ws.paoEmps].sort((a, b) => {
    const tierA = coverageTier(a.uuid);
    const tierB = coverageTier(b.uuid);
    if (tierA !== tierB) return tierA - tierB;

    if (ctx && tierA === 0) {
      const deficitA = minTurnDeficit(ctx, a.uuid);
      const deficitB = minTurnDeficit(ctx, b.uuid);
      if (deficitA !== deficitB) return deficitB - deficitA;
    }

    const devA = byUuid.get(a.uuid)?.turnDeviation ?? 0;
    const devB = byUuid.get(b.uuid)?.turnDeviation ?? 0;
    if (devA !== devB) return devA - devB;

    const curA = ctx?.currentTurnCounts.get(a.uuid) ?? 0;
    const curB = ctx?.currentTurnCounts.get(b.uuid) ?? 0;
    if (curA !== curB) return curA - curB;

    return a.employee.seniority - b.employee.seniority;
  });
}

/** @deprecated Prefer sortPaoForCoverageCandidates — não filtra PAOs no max. */
export function sortPaoForTurnBalance(
  ws: GenerationWorkspace,
  dayIndex: number,
  entries: TurnRateioEntry[],
): GenerationInputEmployee[] {
  return sortPaoForCoverageCandidates(ws, dayIndex, entries);
}
