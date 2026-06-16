import { addDays } from "../rules/dates.js";
import { FANI_LABEL } from "../rules/birthday.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { currentTurnCount } from "./schedule-rateio-context.js";
import { assignmentKey } from "./types.js";
import type { ValidationIssue } from "./types.js";
import { formatPaoPoolSeniority, sortPaoByPoolSeniority } from "./pao-pool-seniority.js";
import { v5CountPreferredVsRestricted } from "./v5-quota-allocation.js";

export interface V5QuotaAuditRow {
  name: string;
  employeeUuid: string;
  seniority: number;
  poolRank: number;
  poolSize: number;
  preferredShift: string | null;
  restrictedShifts: string[];
  target: number;
  min: number;
  max: number;
  finalTurns: number;
  preferredTurnsReceived: number;
  nonPreferredTurnsReceived: number;
  restrictedTurnsBroken: number;
  attendancePercent: number | null;
  status: "OK" | "BELOW_MIN" | "ABOVE_MAX";
}

export function applySpecificShiftRequests(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[],
): void {
  const rows = ws.input.specificShiftRequests ?? [];
  for (const row of rows) {
    if (!ws.days.includes(row.date)) continue;
    const emp = ws.input.employees.find((e) => e.uuid === row.employeeUuid);
    if (!emp) continue;

    const ok = ws.tryAssignShift(row.employeeUuid, row.date, row.shiftCode);
    if (ok) continue;

    const detail = ws.tryAssignShiftDetailed(row.employeeUuid, row.date, row.shiftCode);

    warnings.push({
      severity: "MÉDIA",
      level: "WARNING",
      type: "SPECIFIC_SHIFT_REQUEST_NOT_APPLIED",
      date: row.date,
      employee: emp.employee.name,
      detail:
        `${row.shiftCode} em ${row.date} não aplicado: ${detail.reason ?? "?"}` +
        (detail.details ? ` (${detail.details})` : ""),
    });
  }
}

export function applyFaniFollowingFolga(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[],
): void {
  for (const ge of ws.input.employees) {
    const did = ws.uuidToDomain.get(ge.uuid);
    if (!did) continue;

    for (const day of ws.days) {
      const prev = addDays(day, -1);
      const prevLabel = ws.blocked.get(assignmentKey(did, prev));
      if (prevLabel !== FANI_LABEL) continue;

      const key = assignmentKey(did, day);
      if (ws.blocked.has(key) || ws.planned.has(key)) {
        warnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "FANI_FOLLOWING_DAY_OFF_NOT_APPLIED",
          date: day,
          employee: ge.employee.name,
          detail: `Folga pós-FANI em ${day} não aplicada — dia já ocupado ou bloqueado.`,
        });
        continue;
      }

      ws.lockDay(ge.uuid, day, "FOLGA");
    }
  }
}

export function buildV5QuotaAudit(ws: GenerationWorkspace): V5QuotaAuditRow[] {
  const ctx = ws.rateioContext;
  if (!ctx) return [];

  const rows: V5QuotaAuditRow[] = [];
  for (const c of sortPaoByPoolSeniority(ws)) {
    const uuid = c.uuid;
    const did = ws.uuidToDomain.get(uuid);
    const restricted = did != null ? ws.input.shiftRestrictions?.get(did) : undefined;
    const counts = v5CountPreferredVsRestricted(ws, uuid);
    const finalTurns = currentTurnCount(ctx, uuid);
    const min = ctx.minTurnCounts.get(uuid) ?? 0;
    const max = ctx.maxTurnCounts.get(uuid) ?? finalTurns;
    const target = ctx.targetTurnCounts.get(uuid) ?? 0;

    let status: V5QuotaAuditRow["status"] = "OK";
    if (finalTurns < min) status = "BELOW_MIN";
    else if (finalTurns > max) status = "ABOVE_MAX";

    const pool = ctx.paoPoolSeniorityByEmployee.get(uuid);

    rows.push({
      name: c.employee.name,
      employeeUuid: uuid,
      seniority: c.employee.seniority,
      poolRank: pool?.poolRank ?? 0,
      poolSize: pool?.poolSize ?? ws.paoEmps.length,
      preferredShift: ctx.preferredShiftByEmployee.get(uuid) ?? null,
      restrictedShifts: restricted ? [...restricted] : [],
      target,
      min,
      max,
      finalTurns,
      preferredTurnsReceived: counts.preferred,
      nonPreferredTurnsReceived: counts.nonPreferred,
      restrictedTurnsBroken: counts.restrictedBroken,
      attendancePercent:
        ctx.preferredShiftByEmployee.get(uuid) && finalTurns > 0
          ? Math.round((counts.preferred / finalTurns) * 100)
          : ctx.preferredShiftByEmployee.get(uuid)
            ? 0
            : null,
      status,
    });
  }
  return rows;
}

export function formatV5QuotaAudit(rows: V5QuotaAuditRow[]): string {
  const lines = ["===== MOTOR V5 — COTAS POR SENIORIDADE ====="];
  for (const r of rows) {
    lines.push(
      `${r.name} | ${formatPaoPoolSeniority({ employeeUuid: r.employeeUuid, cadastralSeniority: r.seniority, poolRank: r.poolRank, poolSize: r.poolSize })} | pref=${r.preferredShift ?? "-"} | ` +
        `rest=${r.restrictedShifts.join(",") || "-"} | ` +
        `target=${r.target} min=${r.min} max=${r.max} | turnos=${r.finalTurns} | ` +
        `prefRecv=${r.preferredTurnsReceived} nonPref=${r.nonPreferredTurnsReceived} | ` +
        `atend=${r.attendancePercent != null ? `${r.attendancePercent}%` : "n/a"} | ` +
        `restQuebrada=${r.restrictedTurnsBroken} | ${r.status}`,
    );
  }
  return lines.join("\n");
}
