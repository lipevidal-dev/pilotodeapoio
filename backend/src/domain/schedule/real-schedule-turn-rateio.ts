import { MIN_SHIFTS_FULL_NO_FLIGHT_MONTH } from "../employee/restrictions.js";
import {
  calculateCapacitySummary,
  classifyPlanningGroup,
} from "./demand-planning-capacity.js";
import { calculateOperationalDemand } from "./demand-planning-demand.js";
import type { IndividualTarget, OperationalDemand, PlanningGroup } from "./demand-planning-types.js";
import {
  FULL_NO_FLIGHT_TARGET,
  VACATION_TARGET_30,
  VACATION_TARGET_31,
} from "./demand-planning-types.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";
import { countWorkdayBreakdown } from "./real-schedule-workdays.js";

export interface TurnRateioEntry {
  employeeUuid: string;
  name: string;
  group: PlanningGroup;
  seniority: number;
  turnTarget: number;
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

/** Curso/Simulador/CMA/Outro — reduz alvo de turnos; voo não entra no rateio. */
export function countUsefulOperationalDays(ws: GenerationWorkspace, uuid: string): number {
  const b = countWorkdayBreakdown(ws, uuid);
  return b.cursos + b.simuladores + b.cma + b.outros;
}

/** T6+T7+T8 alocados — ND, folgas e FP não contam. */
export function countAllocatedTurns(ws: GenerationWorkspace, uuid: string): number {
  const b = countWorkdayBreakdown(ws, uuid);
  return b.turnosT6 + b.turnosT7 + b.turnosT8;
}

function vacationFixedTarget(daysInMonth: number): number {
  return daysInMonth >= 31 ? VACATION_TARGET_31 : VACATION_TARGET_30;
}

function distributeIntegerTargets(
  normals: Array<{ employeeUuid: string; useful: number }>,
  totalPool: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (normals.length === 0 || totalPool <= 0) return out;

  const usefulSum = normals.reduce((n, x) => n + x.useful, 0);
  const meta = (totalPool + usefulSum) / normals.length;

  const floats = normals.map((n) => {
    const raw = meta - n.useful;
    const floor = Math.max(0, Math.floor(raw));
    return {
      uuid: n.employeeUuid,
      raw,
      floor,
      frac: raw - floor,
    };
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
  if (entry.group === "FULL_NO_FLIGHT") {
    if (entry.turnDeviation < 0) {
      return `PAO mês sem voo: ${entry.allocatedTurns}/${entry.turnTarget} turnos.`;
    }
    return `PAO mês sem voo acima da meta (${entry.allocatedTurns}/${entry.turnTarget}).`;
  }
  if (entry.usefulOperationalDays > 0 && entry.turnDeviation <= 0) {
    return `${entry.usefulOperationalDays} cadastro(s) útil(is) reduziram alvo em ${entry.usefulOperationalDays} turno(s).`;
  }
  if (entry.turnDeviation < 0) {
    return `Abaixo da meta de turnos (${entry.allocatedTurns}/${entry.turnTarget}).`;
  }
  return `Acima da meta de turnos (${entry.allocatedTurns}/${entry.turnTarget}).`;
}

/**
 * Rateio por turnos alocados — voos não entram; cadastros úteis reduzem alvo individual.
 * PAO FULL_NO_FLIGHT fica fora do rateio normal (meta fixa 20 turnos).
 */
export function computeTurnRateio(ws: GenerationWorkspace): TurnRateioResult {
  const demand = calculateOperationalDemand(ws.days.length);
  const capacity = calculateCapacitySummary(ws);
  const capByUuid = new Map(capacity.byEmployee.map((c) => [c.employeeUuid, c]));
  const warnings: ValidationIssue[] = [];
  const entries: TurnRateioEntry[] = [];
  const targets: IndividualTarget[] = [];

  const sorted = [...ws.paoEmps].sort((a, b) => a.employee.seniority - b.employee.seniority);
  let reservedDemand = 0;

  for (const emp of sorted) {
    const group = classifyPlanningGroup(ws, emp.uuid);
    const useful = countUsefulOperationalDays(ws, emp.uuid);
    const allocated = countAllocatedTurns(ws, emp.uuid);
    const cap = capByUuid.get(emp.uuid)!;

    if (group === "FULL_NO_FLIGHT") {
      const turnTarget = FULL_NO_FLIGHT_TARGET;
      reservedDemand += turnTarget;
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
        turnDeviation: allocated - turnTarget,
      };
      entry.reasonForDeviation = deviationReason(entry);
      entries.push(entry);
      targets.push({
        employeeUuid: emp.uuid,
        name: emp.employee.name,
        group,
        seniority: emp.employee.seniority,
        target: Math.min(requiredT6T7, cap.capacity),
        capacity: cap.capacity,
      });
      if (turnTarget < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
        warnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "RESTRIÇÃO VOO MÊS INTEIRO",
          date: "",
          employee: emp.employee.name,
          detail: `Motor real: meta ${turnTarget}/${MIN_SHIFTS_FULL_NO_FLIGHT_MONTH} turnos para mês sem voo.`,
        });
      }
      continue;
    }

    if (group === "VACATION") {
      const fixed = vacationFixedTarget(ws.days.length);
      reservedDemand += fixed;
      const turnTarget = Math.max(0, fixed - useful);
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
        turnDeviation: allocated - turnTarget,
      };
      entry.reasonForDeviation = deviationReason(entry);
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
  }

  const normals = sorted.filter((e) => classifyPlanningGroup(ws, e.uuid) === "NORMAL");
  const turnosRateio = Math.max(0, demand.totalDemand - reservedDemand);
  const usefulSum = normals.reduce((n, e) => n + countUsefulOperationalDays(ws, e.uuid), 0);
  const metaTurnosNormal =
    normals.length > 0 ? (turnosRateio + usefulSum) / normals.length : 0;

  const normalTargets = distributeIntegerTargets(
    normals.map((e) => ({
      employeeUuid: e.uuid,
      useful: countUsefulOperationalDays(ws, e.uuid),
    })),
    turnosRateio,
  );

  for (const emp of normals) {
    const useful = countUsefulOperationalDays(ws, emp.uuid);
    const allocated = countAllocatedTurns(ws, emp.uuid);
    const cap = capByUuid.get(emp.uuid)!;
    const turnTarget = normalTargets.get(emp.uuid) ?? 0;
    const requiredT6T7 = Math.max(0, turnTarget - allocated);

    const entry: TurnRateioEntry = {
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group: "NORMAL",
      seniority: emp.employee.seniority,
      turnTarget,
      usefulOperationalDays: useful,
      allocatedTurns: allocated,
      requiredT6T7,
      metaTurnosNormal,
      turnDeviation: allocated - turnTarget,
    };
    entry.reasonForDeviation = deviationReason(entry);
    entries.push(entry);
    targets.push({
      employeeUuid: emp.uuid,
      name: emp.employee.name,
      group: "NORMAL",
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

/** Ordena PAOs para cobertura residual respeitando equilíbrio de turnos. */
export function sortPaoForTurnBalance(
  ws: GenerationWorkspace,
  _dayIndex: number,
  entries: TurnRateioEntry[],
): GenerationInputEmployee[] {
  const byUuid = new Map(entries.map((e) => [e.employeeUuid, e]));
  return [...ws.paoEmps]
    .filter((c) => {
      const entry = byUuid.get(c.uuid);
      if (!entry) return true;
      if (entry.group === "FULL_NO_FLIGHT") return entry.allocatedTurns < entry.turnTarget;
      return entry.allocatedTurns < entry.turnTarget;
    })
    .sort((a, b) => {
      const ea = byUuid.get(a.uuid);
      const eb = byUuid.get(b.uuid);
      const devA = ea?.turnDeviation ?? 0;
      const devB = eb?.turnDeviation ?? 0;
      if (devA !== devB) return devA - devB;
      return a.employee.seniority - b.employee.seniority;
    });
}
