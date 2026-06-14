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
    const total = ctx.currentTurnCounts.get(uuid) ?? 0;
    const target = ctx.targetTurnCounts.get(uuid) ?? 0;
    const min = ctx.minTurnCounts.get(uuid) ?? 0;
    const max = ctx.maxTurnCounts.get(uuid) ?? 0;
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

export function formatTurnRateioAuditTable(audits: TurnRateioAudit[]): string {
  const lines: string[] = [
    "Nome | T6 | T7 | T8 | T9 | Total | Min | Target | Max | Status",
  ];
  for (const a of audits) {
    lines.push(
      `${a.employeeName} | ${a.t6Count} | ${a.t7Count} | ${a.t8Count} | ${a.t9Count} | ${a.totalTurns} | ${a.minTurns} | ${a.targetTurns.toFixed(1)} | ${a.maxTurns} | ${a.status}`,
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
