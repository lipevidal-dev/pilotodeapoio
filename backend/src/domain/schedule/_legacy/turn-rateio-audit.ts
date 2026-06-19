import type { ShiftCode } from "./assignment-eligibility.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

export interface TurnRateioAudit {
  employeeId: string;
  employeeName: string;
  t6Count: number;
  t7Count: number;
  t8Count: number;
  t9Count: number;
  totalTurns: number;
  availableDays: number;
  relativeAvailability: number;
  targetTurns: number;
  minTurns: number;
  maxTurns: number;
  aboveMax: boolean;
  belowMin: boolean;
  preferredShift?: ShiftCode | null;
  differenceFromTarget: number;
  status: "OK" | "ATENÇÃO" | "CRÍTICO";
  reasons: string[];
}

function belowMinReason(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
  total: number,
  min: number,
): string | undefined {
  if (total >= min) return undefined;

  const available = ctx.availableDaysByEmployee.get(uuid) ?? ws.days.length;
  const deficit = min - total;

  if (available <= min + 2) {
    return `Abaixo do mínimo proporcional (${total}/${min}) — disponibilidade calendário ${available} dia(s).`;
  }

  const empty = ws.emptyDaysForPao(uuid).length;
  if (empty > 0) {
    return `Abaixo do mínimo proporcional (${total}/${min}) — ${empty} dia(s) livre(s) sem turno.`;
  }

  return `Abaixo do mínimo proporcional (${total}/${min}) — déficit ${deficit} turno(s).`;
}

export function buildTurnRateioAudit(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): TurnRateioAudit[] {
  const audits: TurnRateioAudit[] = [];

  for (const c of ws.paoEmps) {
    const uuid = c.uuid;
    const t6 = ctx.currentT6Counts.get(uuid) ?? 0;
    const t7 = ctx.currentT7Counts.get(uuid) ?? 0;
    const t8 = ctx.currentT8Counts.get(uuid) ?? 0;
    const t9 = ctx.currentT9Counts.get(uuid) ?? 0;
    const total = t6 + t7 + t8 + t9;
    const target = ctx.targetTurnCounts.get(uuid) ?? 0;
    const min = ctx.minTurnCounts.get(uuid) ?? 0;
    const max = ctx.maxTurnCounts.get(uuid) ?? 0;
    const availableDays = ctx.availableDaysByEmployee.get(uuid) ?? ws.days.length;
    const relativeAvailability = ctx.relativeAvailabilityByEmployee.get(uuid) ?? 1;
    const diff = total - target;
    const aboveMax = total > max;
    const belowMin = total < min;

    const reasons: string[] = [];
    let status: TurnRateioAudit["status"] = "OK";

    if (aboveMax) {
      const over = total - max;
      reasons.push("RATEIO_TURNOS_ACIMA_MAX");
      status = over >= 2 ? "CRÍTICO" : "ATENÇÃO";
    }
    if (belowMin) {
      reasons.push("RATEIO_TURNOS_ABAIXO_MIN");
      const detail = belowMinReason(ws, ctx, uuid, total, min);
      if (detail) reasons.push(detail);
      if (status === "OK") status = "ATENÇÃO";
    }

    audits.push({
      employeeId: uuid,
      employeeName: c.employee.name,
      t6Count: t6,
      t7Count: t7,
      t8Count: t8,
      t9Count: t9,
      totalTurns: total,
      availableDays,
      relativeAvailability,
      targetTurns: target,
      minTurns: min,
      maxTurns: max,
      aboveMax,
      belowMin,
      preferredShift: ctx.preferredShiftByEmployee.get(uuid) ?? null,
      differenceFromTarget: diff,
      status,
      reasons,
    });
  }

  return audits.sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"));
}

export function formatProportionalMetaTable(audits: TurnRateioAudit[]): string {
  const lines: string[] = [
    "===== META PROPORCIONAL =====",
    "Nome | Atual | Min | Target | Max | Déficit | Excesso",
  ];
  for (const a of audits) {
    const deficit = Math.max(0, a.minTurns - a.totalTurns);
    const excess = Math.max(0, a.totalTurns - a.targetTurns);
    lines.push(
      `${a.employeeName} | ${a.totalTurns} | ${a.minTurns} | ${a.targetTurns.toFixed(1)} | ${a.maxTurns} | ${deficit} | ${excess.toFixed(1)}`,
    );
  }
  return lines.join("\n");
}

export function formatTurnRateioAuditTable(audits: TurnRateioAudit[]): string {
  const lines: string[] = [
    "Nome | T6 | T7 | T8 | T9 | Total | Disp | Rel | Min | Target | Max | Status",
  ];
  for (const a of audits) {
    lines.push(
      `${a.employeeName} | ${a.t6Count} | ${a.t7Count} | ${a.t8Count} | ${a.t9Count} | ${a.totalTurns} | ${a.availableDays} | ${a.relativeAvailability.toFixed(2)} | ${a.minTurns} | ${a.targetTurns.toFixed(1)} | ${a.maxTurns} | ${a.status}`,
    );
  }
  return lines.join("\n");
}

export function formatCoverageTable(ws: GenerationWorkspace): string {
  const lines: string[] = ["Dia | T6 | T7 | T8 | Gaps"];
  for (const day of ws.days) {
    const t6 = ws.hasPaoCoverage(day, "T6") ? "OK" : "--";
    const t7 = ws.hasPaoCoverage(day, "T7") ? "OK" : "--";
    const t8 = ws.hasPaoCoverage(day, "T8") ? "OK" : "--";
    const gaps = [t6, t7, t8].filter((x) => x === "--").length;
    lines.push(`${day} | ${t6} | ${t7} | ${t8} | ${gaps}`);
  }
  return lines.join("\n");
}
