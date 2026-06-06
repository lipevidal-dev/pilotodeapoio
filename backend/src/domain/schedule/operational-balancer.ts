import {
  IDEAL_PAO_REST_COUNT,
  MAX_CONSECUTIVE_WORK_DAYS,
  MIN_PAO_REST_COUNT,
} from "../rules/constants.js";
import { MIN_SHIFTS_FULL_NO_FLIGHT_MONTH } from "../employee/restrictions.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import {
  buildOperationalSummary,
  type EmployeeOperationalSummary,
  type OperationalSummaryResult,
} from "./operational-summary.js";
import {
  longestStreakMiddleDay,
  workDatesFromWorkspace,
} from "./operational-audit.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { ScheduleRepairEngine } from "./schedule-repair-engine.js";
import type { ValidationIssue } from "./types.js";
import { assignmentKey } from "./types.js";

export type BalanceActionKind =
  | "flight_removed"
  | "flight_relocated"
  | "folga_inserted"
  | "shift_removed"
  | "shift_relocated"
  | "shift_added"
  | "warning";

export interface BalanceAction {
  kind: BalanceActionKind;
  employee: string;
  employeeUuid: string;
  date?: string;
  detail: string;
}

export interface OperationalBalanceReport {
  iterations: number;
  acceptable: boolean;
  before: EmployeeOperationalSummary[];
  after: EmployeeOperationalSummary[];
  actions: BalanceAction[];
  warnings: ValidationIssue[];
  flightsRemoved: number;
  flightsRelocated: number;
  folgasInserted: number;
  shiftsRemoved: number;
  shiftsRelocated: number;
  shiftsAdded: number;
}

const MAX_BALANCE_ROUNDS = 6;
const IDEAL_PAO_SHIFTS = 20;
const HIGH_WORKDAY_THRESHOLD = 22;

function paoStats(summary: OperationalSummaryResult): EmployeeOperationalSummary[] {
  return summary.byEmployee.filter((e) => e.type === "PAO");
}

function excessFlightThreshold(paos: EmployeeOperationalSummary[]): number {
  const voos = paos.map((e) => e.voos);
  if (voos.length === 0) return 3;
  const sorted = [...voos].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return Math.max(2, median + 1);
}

function motorVooDays(ws: GenerationWorkspace, uuid: string): string[] {
  return ws.allocations
    .filter(
      (a) =>
        a.employeeUuid === uuid &&
        normalizeOperationalLabel(a.label).toUpperCase() === "VOO" &&
        !ws.isInputFlightDay(uuid, a.date),
    )
    .map((a) => a.date)
    .sort();
}

/** Verifica remoção sem efetivar — restaura turno após teste. */
function canRemoveShiftDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const code = ws.planned.get(assignmentKey(did, day));
  if (!code || code === "T8") return false;
  const removed = ws.tryRemoveShiftPreservingCoverage(uuid, day);
  if (removed) ws.planned.set(assignmentKey(did, day), code);
  return removed;
}

function countActions(actions: BalanceAction[], kind: BalanceActionKind): number {
  return actions.filter((a) => a.kind === kind).length;
}

export class OperationalBalancer {
  constructor(private readonly repairEngine = new ScheduleRepairEngine()) {}

  balance(ws: GenerationWorkspace, violations: ValidationIssue[] = []): OperationalBalanceReport {
    const actions: BalanceAction[] = [];
    const balanceWarnings: ValidationIssue[] = [];
    const before = buildOperationalSummary(ws, violations).byEmployee;
    let iterations = 0;

    const initialSummary = buildOperationalSummary(ws, violations);
    if (this.isAcceptable(ws, initialSummary, violations) && !this.hasDeviations(ws, initialSummary)) {
      return {
        iterations: 0,
        acceptable: true,
        before,
        after: before,
        actions: [],
        warnings: [],
        flightsRemoved: 0,
        flightsRelocated: 0,
        folgasInserted: 0,
        shiftsRemoved: 0,
        shiftsRelocated: 0,
        shiftsAdded: 0,
      };
    }

    for (iterations = 0; iterations < MAX_BALANCE_ROUNDS; iterations++) {
      const summary = buildOperationalSummary(ws, [...violations, ...balanceWarnings]);
      if (this.isAcceptable(ws, summary, violations)) break;

      let progress = false;
      progress = this.fixCritical(ws, actions) || progress;
      progress = this.fixInsufficientFolgas(ws, summary, actions) || progress;
      progress = this.fixHighMaxConsec(ws, summary, actions, balanceWarnings) || progress;
      progress = this.fixExcessFlights(ws, summary, actions) || progress;
      progress = this.fixWorkdayDistribution(ws, summary, actions) || progress;
      progress = this.fixFullMonthNoFlight(ws, summary, actions) || progress;

      ws.finalizePaoFolgaCounts();
      ws.revalidateCoverageAfterBalance();

      if (!progress) break;
    }

    ws.finalizePaoFolgaCounts();
    ws.revalidateCoverageAfterBalance();
    const finalSummary = buildOperationalSummary(ws, [...violations, ...balanceWarnings]);
    this.fixHighMaxConsec(ws, finalSummary, actions, balanceWarnings);
    ws.revalidateCoverageAfterBalance();

    this.emitRemainingWarnings(ws, balanceWarnings, violations);

    const after = buildOperationalSummary(ws, [...violations, ...balanceWarnings]).byEmployee;
    const acceptable = this.isAcceptable(ws, { byEmployee: after }, violations);

    return {
      iterations,
      acceptable,
      before,
      after,
      actions,
      warnings: balanceWarnings,
      flightsRemoved: countActions(actions, "flight_removed"),
      flightsRelocated: countActions(actions, "flight_relocated"),
      folgasInserted: countActions(actions, "folga_inserted"),
      shiftsRemoved: countActions(actions, "shift_removed"),
      shiftsRelocated: countActions(actions, "shift_relocated"),
      shiftsAdded: countActions(actions, "shift_added"),
    };
  }

  private hasDeviations(ws: GenerationWorkspace, summary: OperationalSummaryResult): boolean {
    const paos = paoStats(summary);
    const threshold = excessFlightThreshold(paos);
    if (ws.listCoverageGaps().length > 0) return true;
    for (const p of paos) {
      if (p.folgas < MIN_PAO_REST_COUNT) return true;
      if (p.maxConsec > MAX_CONSECUTIVE_WORK_DAYS) return true;
      if (p.voos > threshold) return true;
      if (ws.isFullMonthNoFlight(p.employeeUuid) && p.turnos < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
        return true;
      }
    }
    return false;
  }

  private isAcceptable(
    ws: GenerationWorkspace,
    summary: Pick<OperationalSummaryResult, "byEmployee">,
    violations: ValidationIssue[],
  ): boolean {
    const paos = paoStats(summary as OperationalSummaryResult);
    const gaps = ws.listCoverageGaps().length;
    if (gaps > 0) return false;

    const critical = violations.filter((v) => v.level === "CRITICAL" || v.severity === "ALTA");
    if (critical.length > 0) return false;

    for (const p of paos) {
      if (p.folgas < MIN_PAO_REST_COUNT) return false;
      if (p.maxConsec > MAX_CONSECUTIVE_WORK_DAYS) return false;
      if (ws.isFullMonthNoFlight(p.employeeUuid) && p.turnos < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
        return false;
      }
    }
    return true;
  }

  private fixCritical(ws: GenerationWorkspace, actions: BalanceAction[]): boolean {
    const gapsBefore = ws.listCoverageGaps().length;
    if (gapsBefore === 0) return false;
    const repair = this.repairEngine.repair(ws, []);
    if (repair.repaired > 0) {
      actions.push({
        kind: "shift_relocated",
        employee: "",
        employeeUuid: "",
        detail: `Reparo de cobertura: ${repair.repaired} turno(s) realocado(s).`,
      });
      return true;
    }
    return false;
  }

  private fixInsufficientFolgas(
    ws: GenerationWorkspace,
    summary: OperationalSummaryResult,
    actions: BalanceAction[],
  ): boolean {
    let progress = false;
    const paos = [...paoStats(summary)]
      .filter((p) => p.folgas < MIN_PAO_REST_COUNT || ws.countRest(p.employeeUuid) < MIN_PAO_REST_COUNT)
      .sort((a, b) => a.folgas - b.folgas);

    for (const emp of paos) {
      const uuid = emp.employeeUuid;
      let safety = 0;
      while (ws.countRest(uuid) < MIN_PAO_REST_COUNT && ws.canAddFolga(uuid) && safety++ < 15) {
        const voos = motorVooDays(ws, uuid);
        if (voos.length > 0) {
          const day = voos[voos.length - 1]!;
          if (ws.tryRemoveMotorVoo(uuid, day)) {
            actions.push({
              kind: "flight_removed",
              employee: emp.name,
              employeeUuid: uuid,
              date: day,
              detail: `VOO removido para liberar folga (${ws.countRest(uuid)}/${MIN_PAO_REST_COUNT}).`,
            });
            if (ws.tryBalanceInsertFolga(uuid)) {
              actions.push({
                kind: "folga_inserted",
                employee: emp.name,
                employeeUuid: uuid,
                detail: `Folga inserida após remoção de VOO.`,
              });
            }
            progress = true;
            continue;
          }
        }

        const shiftDays = ws.days.filter((d) => canRemoveShiftDay(ws, uuid, d));
        if (shiftDays.length > 0) {
          const day = shiftDays[shiftDays.length - 1]!;
          if (ws.tryRemoveShiftPreservingCoverage(uuid, day)) {
            ws.lockDay(uuid, day, "FOLGA");
            actions.push({
              kind: "shift_removed",
              employee: emp.name,
              employeeUuid: uuid,
              date: day,
              detail: `Turno removido e convertido em folga (${ws.countRest(uuid)}/${MIN_PAO_REST_COUNT}).`,
            });
            progress = true;
            continue;
          }
        }

        if (ws.tryBalanceInsertFolga(uuid)) {
          actions.push({
            kind: "folga_inserted",
            employee: emp.name,
            employeeUuid: uuid,
            detail: `Folga inserida em dia disponível.`,
          });
          progress = true;
          continue;
        }
        break;
      }
    }
    return progress;
  }

  private fixHighMaxConsec(
    ws: GenerationWorkspace,
    summary: OperationalSummaryResult,
    actions: BalanceAction[],
    warnings: ValidationIssue[],
  ): boolean {
    let progress = false;
    const offenders = paoStats(summary)
      .filter((p) => p.maxConsec > MAX_CONSECUTIVE_WORK_DAYS)
      .sort((a, b) => b.maxConsec - a.maxConsec);

    for (const emp of offenders) {
      const uuid = emp.employeeUuid;
      const workDates = workDatesFromWorkspace(ws, uuid);
      const middle = longestStreakMiddleDay(workDates, MAX_CONSECUTIVE_WORK_DAYS + 1);
      if (!middle) continue;

      if (ws.tryBreakMaxConsecutiveStreak(uuid, middle)) {
        const insertedFolga = ws.allocations.some(
          (a) => a.employeeUuid === uuid && a.date === middle && a.label === "FOLGA",
        );
        actions.push({
          kind: insertedFolga ? "folga_inserted" : "shift_removed",
          employee: emp.name,
          employeeUuid: uuid,
          date: middle,
          detail: insertedFolga
            ? `Folga inserida para quebrar sequência de ${emp.maxConsec} dias.`
            : `Dia liberado para quebrar sequência de ${emp.maxConsec} dias.`,
        });
        progress = true;
      } else {
        const existing = warnings.some(
          (w) => w.employee === emp.name && w.type === "MAX CONSECUTIVO",
        );
        if (!existing) {
          warnings.push({
            severity: "MÉDIA",
            level: "WARNING",
            type: "MAX CONSECUTIVO",
            date: middle,
            employee: emp.name,
            detail: `Não foi possível quebrar sequência de ${emp.maxConsec} dias consecutivos.`,
          });
        }
      }
    }
    return progress;
  }

  private fixExcessFlights(
    ws: GenerationWorkspace,
    summary: OperationalSummaryResult,
    actions: BalanceAction[],
  ): boolean {
    let progress = false;
    const paos = paoStats(summary);
    const threshold = excessFlightThreshold(paos);
    const heavy = paos.filter((p) => p.voos > threshold).sort((a, b) => b.voos - a.voos);

    for (const emp of heavy) {
      const uuid = emp.employeeUuid;
      let safety = 0;
      while (motorVooDays(ws, uuid).length > threshold && safety++ < 10) {
        const voos = motorVooDays(ws, uuid);
        const day = voos[voos.length - 1]!;
        if (ws.tryRelocateMotorVoo(uuid, day)) {
          actions.push({
            kind: "flight_relocated",
            employee: emp.name,
            employeeUuid: uuid,
            date: day,
            detail: `VOO realocado para PAO elegível.`,
          });
          progress = true;
          continue;
        }
        if (ws.tryRemoveMotorVoo(uuid, day)) {
          actions.push({
            kind: "flight_removed",
            employee: emp.name,
            employeeUuid: uuid,
            date: day,
            detail: `VOO removido por excesso (>${threshold}).`,
          });
          progress = true;
          continue;
        }
        break;
      }
    }
    return progress;
  }

  private fixWorkdayDistribution(
    ws: GenerationWorkspace,
    summary: OperationalSummaryResult,
    actions: BalanceAction[],
  ): boolean {
    let progress = false;
    const overloaded = paoStats(summary)
      .filter((p) => p.turnos > HIGH_WORKDAY_THRESHOLD || p.diasTrabalhados > HIGH_WORKDAY_THRESHOLD + 2)
      .sort((a, b) => b.diasTrabalhados - a.diasTrabalhados);

    for (const emp of overloaded) {
      const uuid = emp.employeeUuid;
      if (ws.countRest(uuid) < MIN_PAO_REST_COUNT || !ws.canAddFolga(uuid)) continue;
      const shiftDays = ws.days.filter((d) => canRemoveShiftDay(ws, uuid, d));
      if (shiftDays.length === 0) continue;
      const day = shiftDays[Math.floor(shiftDays.length / 2)]!;
      if (ws.tryRemoveShiftPreservingCoverage(uuid, day)) {
        ws.lockDay(uuid, day, "FOLGA");
        actions.push({
          kind: "shift_removed",
          employee: emp.name,
          employeeUuid: uuid,
          date: day,
          detail: `Turno convertido em folga para reduzir dias trabalhados (${emp.diasTrabalhados}).`,
        });
        progress = true;
      }
    }
    return progress;
  }

  private fixFullMonthNoFlight(
    ws: GenerationWorkspace,
    summary: OperationalSummaryResult,
    actions: BalanceAction[],
  ): boolean {
    let progress = false;
    for (const emp of paoStats(summary)) {
      const uuid = emp.employeeUuid;
      if (!ws.isFullMonthNoFlight(uuid)) continue;
      if (emp.turnos >= MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) continue;

      for (const day of motorVooDays(ws, uuid)) {
        if (ws.tryRemoveMotorVoo(uuid, day)) {
          actions.push({
            kind: "flight_removed",
            employee: emp.name,
            employeeUuid: uuid,
            date: day,
            detail: "VOO removido — PAO com mês inteiro sem voo.",
          });
          progress = true;
        }
      }

      const before = emp.turnos;
      ws.ensureMinShiftsForFullMonthNoFlight();
      const after = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)?.turnos ?? before;
      if (after > before) {
        actions.push({
          kind: "shift_added",
          employee: emp.name,
          employeeUuid: uuid,
          detail: `Turnos alocados para atingir meta de ${IDEAL_PAO_SHIFTS} (${before}→${after}).`,
        });
        progress = true;
      }
    }
    return progress;
  }

  private emitRemainingWarnings(
    ws: GenerationWorkspace,
    warnings: ValidationIssue[],
    violations: ValidationIssue[],
  ): void {
    const summary = buildOperationalSummary(ws, [...violations, ...warnings]);
    for (const emp of paoStats(summary)) {
      if (emp.folgas < MIN_PAO_REST_COUNT) {
        const exists = warnings.some((w) => w.employee === emp.name && w.type === "FOLGAS PAO");
        if (!exists) {
          warnings.push({
            severity: "ALTA",
            level: "WARNING",
            type: "FOLGAS PAO",
            date: "",
            employee: emp.name,
            detail: `${emp.name}: ${emp.folgas}/${IDEAL_PAO_REST_COUNT} folgas após balanceamento.`,
          });
        }
      }
      if (emp.maxConsec > MAX_CONSECUTIVE_WORK_DAYS) {
        const exists = warnings.some((w) => w.employee === emp.name && w.type === "MAX CONSECUTIVO");
        if (!exists) {
          warnings.push({
            severity: "MÉDIA",
            level: "WARNING",
            type: "MAX CONSECUTIVO",
            date: "",
            employee: emp.name,
            detail: `MAX CONSEC ${emp.maxConsec} dias após balanceamento.`,
          });
        }
      }
      if (ws.isFullMonthNoFlight(emp.employeeUuid) && emp.turnos < MIN_SHIFTS_FULL_NO_FLIGHT_MONTH) {
        const exists = warnings.some((w) => w.employee === emp.name && w.type === "RESTRIÇÃO VOO MÊS INTEIRO");
        if (!exists) {
          warnings.push({
            severity: "MÉDIA",
            level: "WARNING",
            type: "RESTRIÇÃO VOO MÊS INTEIRO",
            date: "",
            employee: emp.name,
            detail: `Apenas ${emp.turnos}/${MIN_SHIFTS_FULL_NO_FLIGHT_MONTH} turnos após balanceamento.`,
          });
        }
      }
    }
    const gaps = ws.listCoverageGaps();
    if (gaps.length > 0) {
      warnings.push({
        severity: "ALTA",
        level: "WARNING",
        type: "COBERTURA",
        date: gaps[0]?.date ?? "",
        employee: "",
        detail: `${gaps.length} furo(s) de cobertura após balanceamento.`,
      });
    }
  }
}

export const operationalBalancer = new OperationalBalancer();
