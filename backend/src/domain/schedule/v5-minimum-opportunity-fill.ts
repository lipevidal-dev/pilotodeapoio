import { PAO_COVERAGE_SHIFTS } from "../rules/constants.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import {
  buildPaoPoolSeniorityIndex,
  comparePaoPoolRank,
} from "./pao-pool-seniority.js";
import {
  currentTurnCount,
  syncRateioCountsFromWorkspace,
  type ScheduleRateioContext,
} from "./schedule-rateio-context.js";
import { evaluateTryAssignShiftDetailed } from "./try-assign-shift-detailed.js";
import type { ValidationIssue } from "./types.js";

export interface V55MinimumOpportunityEmployeeAudit {
  employeeUuid: string;
  name: string;
  before: number;
  min: number;
  after: number;
  attempts: number;
  accepted: number;
  failReason: string;
}

export interface V55MinimumOpportunityReport {
  totalAttempts: number;
  totalAccepted: number;
  employeesHelped: number;
  stillBelowMin: number;
}

export function clearV55MinimumOpportunityAudit(ws: GenerationWorkspace): void {
  ws.v55MinimumOpportunityAudit.length = 0;
}

function minTurnTarget(ctx: ScheduleRateioContext, uuid: string): number {
  return ctx.minTurnCounts.get(uuid) ?? 0;
}

function deficit(ctx: ScheduleRateioContext, uuid: string): number {
  return Math.max(0, minTurnTarget(ctx, uuid) - currentTurnCount(ctx, uuid));
}

function sortPaoByDeficitThenSeniority(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): GenerationInputEmployee[] {
  const index = buildPaoPoolSeniorityIndex(ws);
  return [...ws.paoEmps]
    .filter((c) => deficit(ctx, c.uuid) > 0)
    .sort((a, b) => {
      const defA = deficit(ctx, a.uuid);
      const defB = deficit(ctx, b.uuid);
      if (defB !== defA) return defB - defA;
      return comparePaoPoolRank(index, a.uuid, b.uuid);
    });
}

function shiftsToTry(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
): ShiftCode[] {
  const preferred = ctx.preferredShiftByEmployee.get(uuid);
  const allowed = new Set(ws.allowedShiftsForEmployee(uuid, [...PAO_COVERAGE_SHIFTS, "T9"]));
  const ordered: ShiftCode[] = [];
  if (preferred && allowed.has(preferred)) ordered.push(preferred);
  for (const code of PAO_COVERAGE_SHIFTS) {
    if (code === preferred) continue;
    if (allowed.has(code)) ordered.push(code);
  }
  if (allowed.has("T9")) ordered.push("T9");
  return ordered;
}

function ensureEmployeeAudit(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
  beforeCounts: Map<string, number>,
): V55MinimumOpportunityEmployeeAudit {
  const existing = ws.v55MinimumOpportunityAudit.find((r) => r.employeeUuid === uuid);
  if (existing) return existing;

  const emp = ws.input.employees.find((e) => e.uuid === uuid);
  const row: V55MinimumOpportunityEmployeeAudit = {
    employeeUuid: uuid,
    name: emp?.employee.name ?? uuid,
    before: beforeCounts.get(uuid) ?? currentTurnCount(ctx, uuid),
    min: minTurnTarget(ctx, uuid),
    after: currentTurnCount(ctx, uuid),
    attempts: 0,
    accepted: 0,
    failReason: "",
  };
  ws.v55MinimumOpportunityAudit.push(row);
  return row;
}

/**
 * V5.5 — PAO abaixo do mínimo proporcional recebe tentativas reais em dias livres elegíveis,
 * antes do repair final. Ordem: maior déficit → senioridade; turno preferido primeiro.
 */
export function minimumOpportunityFill(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[],
): V55MinimumOpportunityReport {
  const ctx = ws.ensureRateioContext();
  ws.syncRateioContext();

  const beforeCounts = new Map<string, number>();
  for (const c of ws.paoEmps) {
    beforeCounts.set(c.uuid, currentTurnCount(ctx, c.uuid));
  }

  let totalAttempts = 0;
  let totalAccepted = 0;
  const helped = new Set<string>();

  while (true) {
    const queue = sortPaoByDeficitThenSeniority(ws, ctx);
    if (queue.length === 0) break;

    let roundProgress = false;

    for (const c of queue) {
      const uuid = c.uuid;
      const min = minTurnTarget(ctx, uuid);
      if (currentTurnCount(ctx, uuid) >= min) continue;

      const audit = ensureEmployeeAudit(ws, ctx, uuid, beforeCounts);
      let employeeProgress = false;

      for (const day of ws.days) {
        if (currentTurnCount(ctx, uuid) >= min) break;
        if (!ws.isPaoDayEmpty(uuid, day)) continue;
        if (ws.isLockedByAdmin(uuid, day)) continue;

        for (const shift of shiftsToTry(ws, ctx, uuid)) {
          totalAttempts++;
          audit.attempts++;

          const gapsBefore = ws.listCoverageGaps().length;
          const turnsBefore = currentTurnCount(ctx, uuid);
          const detail = evaluateTryAssignShiftDetailed(ws, uuid, day, shift, false);

          if (!detail.ok) {
            audit.failReason = detail.details ?? detail.reason ?? "tryAssignShift recusou";
            continue;
          }

          if (!ws.tryAssignShift(uuid, day, shift, false)) {
            audit.failReason = "tryAssignShift recusou após avaliação positiva";
            continue;
          }

          syncRateioCountsFromWorkspace(ws, ctx);

          if (ws.listCoverageGaps().length > gapsBefore) {
            ws.unassignShift(uuid, day, { bypassMinimumLock: true });
            syncRateioCountsFromWorkspace(ws, ctx);
            audit.failReason = "revertido — abriria gap de cobertura";
            continue;
          }

          if (currentTurnCount(ctx, uuid) <= turnsBefore) {
            ws.unassignShift(uuid, day, { bypassMinimumLock: true });
            syncRateioCountsFromWorkspace(ws, ctx);
            audit.failReason = "sem ganho rateio";
            continue;
          }

          totalAccepted++;
          audit.accepted++;
          audit.after = currentTurnCount(ctx, uuid);
          audit.failReason = "";
          helped.add(uuid);
          employeeProgress = true;
          roundProgress = true;
          break;
        }
        if (employeeProgress) break;
      }

      if (!employeeProgress && audit.attempts > 0 && audit.accepted === 0 && !audit.failReason) {
        audit.failReason = "sem dia/turno elegível";
      }
    }

    if (!roundProgress) break;
  }

  for (const row of ws.v55MinimumOpportunityAudit) {
    row.after = currentTurnCount(ctx, row.employeeUuid);
  }

  let stillBelowMin = 0;
  for (const c of ws.paoEmps) {
    if (currentTurnCount(ctx, c.uuid) < minTurnTarget(ctx, c.uuid)) stillBelowMin++;
  }

  if (stillBelowMin > 0) {
    warnings.push({
      severity: "MÉDIA",
      level: "WARNING",
      type: "V55_MINIMUM_OPPORTUNITY_INCOMPLETE",
      date: "",
      employee: `${stillBelowMin} PAO(s)`,
      detail: "Oportunidades V5.5 esgotadas antes do mínimo — repair final continuará.",
    });
  }

  return {
    totalAttempts,
    totalAccepted,
    employeesHelped: helped.size,
    stillBelowMin,
  };
}

export function formatV55MinimumOpportunityAudit(ws: GenerationWorkspace): string {
  const lines: string[] = [
    "===== V5.5 MINIMUM OPPORTUNITY FILL =====",
    "funcionário | antes | min | depois | tentativas | aceitas | motivo se falhou",
  ];

  if (ws.v55MinimumOpportunityAudit.length === 0) {
    lines.push("(nenhum PAO abaixo do mínimo no início da fase)");
    return lines.join("\n");
  }

  const sorted = [...ws.v55MinimumOpportunityAudit].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
  for (const row of sorted) {
    lines.push(
      `${row.name} | ${row.before} | ${row.min} | ${row.after} | ${row.attempts} | ${row.accepted} | ${row.failReason || "—"}`,
    );
  }
  return lines.join("\n");
}
