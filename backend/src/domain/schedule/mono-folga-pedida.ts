import { canWork } from "../rules/eligibility.js";
import { addDays } from "../rules/dates.js";
import { PAO_COVERAGE_SHIFTS } from "../rules/constants.js";
import { assignmentKey } from "./types.js";
import { GENERATOR_REST_LABELS, type GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";

/** Máximo de folgas sociais (FS) por PAO/mês quando não há configuração explícita. */
export const MAX_SOCIAL_FOLGAS_PER_MONTH = 2;

export interface MonoFolgaAttempt {
  employeeUuid: string;
  employeeName: string;
  fpDate: string;
  corrected: boolean;
  adjacentDay?: string;
  side?: "before" | "after";
  reason?: string;
}

export interface MonoFolgaAuditResult {
  detected: number;
  corrected: number;
  attempts: MonoFolgaAttempt[];
  warnings: ValidationIssue[];
}

function hasRestOnDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  if (!ws.days.includes(day)) return false;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const blocked = ws.blocked.get(assignmentKey(did, day));
  if (blocked && GENERATOR_REST_LABELS.has(blocked)) return true;
  return ws.allocations.some(
    (a) => a.employeeUuid === uuid && a.date === day && GENERATOR_REST_LABELS.has(a.label),
  );
}

function hasShiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did || !ws.days.includes(day)) return false;
  return ws.planned.has(assignmentKey(did, day));
}

function isMonoFolgaPedida(ws: GenerationWorkspace, uuid: string, fpDate: string): boolean {
  const hasFp = ws.allocations.some(
    (a) => a.employeeUuid === uuid && a.date === fpDate && a.label === "FOLGA PEDIDA",
  );
  if (!hasFp) return false;
  const prev = addDays(fpDate, -1);
  const next = addDays(fpDate, 1);
  const prevRest = !ws.days.includes(prev) || hasRestOnDay(ws, uuid, prev);
  const nextRest = !ws.days.includes(next) || hasRestOnDay(ws, uuid, next);
  return !prevRest && !nextRest;
}

function coverageImpact(ws: GenerationWorkspace, uuid: string, day: string): number {
  if (!ws.days.includes(day)) return Number.POSITIVE_INFINITY;
  if (hasShiftOnDay(ws, uuid, day)) return Number.POSITIVE_INFINITY;

  const did = ws.uuidToDomain.get(uuid)!;
  const emp = ws.input.employees.find((e) => e.uuid === uuid)!.employee;
  let impact = 0;

  for (const code of PAO_COVERAGE_SHIFTS) {
    if (ws.hasPaoCoverage(day, code)) continue;
    const check = canWork(emp, day, code, ws.blocked, ws.planned, ws.canWorkOpts);
    if (check.ok) impact++;
  }

  if (ws.blocked.has(assignmentKey(did, day))) return Number.POSITIVE_INFINITY;
  return impact;
}

function canPlaceAdjacentFolga(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  if (!ws.days.includes(day)) return false;
  if (!ws.canAddFolga(uuid)) return false;
  if (hasShiftOnDay(ws, uuid, day)) return false;
  if (hasRestOnDay(ws, uuid, day)) return false;

  const did = ws.uuidToDomain.get(uuid)!;
  if (ws.blocked.has(assignmentKey(did, day))) return false;
  if (ws.isLockedByAdmin(uuid, day)) return false;

  const fsCount = ws.allocations.filter(
    (a) => a.employeeUuid === uuid && a.label === "FOLGA SOCIAL",
  ).length;
  if (fsCount >= MAX_SOCIAL_FOLGAS_PER_MONTH) return false;

  return true;
}

function pickAdjacentSide(
  ws: GenerationWorkspace,
  uuid: string,
  fpDate: string,
): { day: string; side: "before" | "after" } | null {
  const before = addDays(fpDate, -1);
  const after = addDays(fpDate, 1);

  const options: Array<{ day: string; side: "before" | "after"; impact: number }> = [];

  if (canPlaceAdjacentFolga(ws, uuid, before)) {
    options.push({ day: before, side: "before", impact: coverageImpact(ws, uuid, before) });
  }
  if (canPlaceAdjacentFolga(ws, uuid, after)) {
    options.push({ day: after, side: "after", impact: coverageImpact(ws, uuid, after) });
  }

  if (options.length === 0) return null;

  options.sort((a, b) => {
    if (a.impact !== b.impact) return a.impact - b.impact;
    return a.side === "before" ? -1 : 1;
  });

  const best = options[0];
  return { day: best.day, side: best.side };
}

/** Tenta eliminar mono-folgas pedidas adicionando folga adjacente (F). */
export function correctMonoFolgasPedidas(ws: GenerationWorkspace): MonoFolgaAuditResult {
  const attempts: MonoFolgaAttempt[] = [];
  const warnings: ValidationIssue[] = [];
  let detected = 0;
  let corrected = 0;

  for (const c of ws.paoEmps) {
    for (const day of ws.days) {
      if (!isMonoFolgaPedida(ws, c.uuid, day)) continue;
      detected++;

      const pick = pickAdjacentSide(ws, c.uuid, day);
      if (!pick) {
        const attempt: MonoFolgaAttempt = {
          employeeUuid: c.uuid,
          employeeName: c.employee.name,
          fpDate: day,
          corrected: false,
          reason: "não foi possível adicionar folga adjacente sem quebrar cobertura ou limites",
        };
        attempts.push(attempt);
        warnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "MONO-FOLGA PEDIDA",
          date: day,
          employee: c.employee.name,
          detail:
            "Folga pedida isolada não pôde ser agrupada com folga adjacente por inviabilidade operacional.",
        });
        continue;
      }

      ws.lockDay(c.uuid, pick.day, "FOLGA");
      corrected++;
      attempts.push({
        employeeUuid: c.uuid,
        employeeName: c.employee.name,
        fpDate: day,
        corrected: true,
        adjacentDay: pick.day,
        side: pick.side,
      });
    }
  }

  return { detected, corrected, attempts, warnings };
}

/** Dias preferenciais para iniciar bloco de turno logo após FP isolada (mono-folga pedida). */
export function blockAnchorDaysAfterMonoFolgaPedida(
  ws: GenerationWorkspace,
  uuid: string,
): string[] {
  const anchors: string[] = [];
  for (const day of ws.days) {
    if (!isMonoFolgaPedida(ws, uuid, day)) continue;
    const after = addDays(day, 1);
    if (ws.days.includes(after)) anchors.push(after);
  }
  return anchors;
}
