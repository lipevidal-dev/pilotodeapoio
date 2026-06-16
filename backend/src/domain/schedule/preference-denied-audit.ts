import { evaluateTryAssignShiftDetailed } from "./try-assign-shift-detailed.js";
import type { TryAssignShiftRejectReason } from "./try-assign-shift-detailed.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
import { isNdDayAfterOwnT8Pair } from "./schedule-grid-source.js";
import { formatPaoPoolSeniority } from "./pao-pool-seniority.js";

export type PreferenceDeniedReason =
  | "COBERTURA"
  | "DAY_OCCUPIED"
  | "MIN_PROPORCIONAL"
  | "DESCANSO_12H"
  | "T8_PAIR"
  | "MAX_PROPORCIONAL"
  | "PREALLOCATION"
  | "RESTricao"
  | "OUTRO";

export interface PreferenceDeniedSlot {
  date: string;
  shift: ShiftCode;
  receiverUuid: string | null;
  receiverName: string;
  receiverSeniority: number | null;
  receiverPoolRank: number | null;
  receiverPoolSize: number | null;
  reason: PreferenceDeniedReason;
  detail: string;
}

export interface PreferenceDeniedEmployeeAudit {
  employeeUuid: string;
  name: string;
  seniority: number;
  poolRank: number;
  poolSize: number;
  preferredShift: ShiftCode;
  totalTurns: number;
  preferredReceived: number;
  /** preferidosRecebidos / totalTurnosFuncionario */
  attendancePercent: number;
  /** preferidosRecebidos / oportunidadesPossíveis (métrica secundária) */
  opportunityPercent: number;
  possible: number;
  lost: number;
  lostSlots: PreferenceDeniedSlot[];
  reasonSummary: Partial<Record<PreferenceDeniedReason, number>>;
}

export interface SeniorityPreferenceVerdict {
  preferredShift: ShiftCode;
  rows: Array<{
    name: string;
    seniority: number;
    poolRank: number;
    poolSize: number;
    attendancePercent: number;
    opportunityPercent: number;
    received: number;
    totalTurns: number;
    possible: number;
  }>;
  oldest: { name: string; seniority: number; poolRank: number; poolSize: number; attendancePercent: number };
  newest: { name: string; seniority: number; poolRank: number; poolSize: number; attendancePercent: number };
  deltaPercent: number;
  verdict:
    | "SENIORIDADE OBSERVADA"
    | "SENIORIDADE PARCIALMENTE OBSERVADA"
    | "SENIORIDADE NÃO OBSERVADA"
    | "AMOSTRA INSUFICIENTE";
}

const HARD_EXCLUDE: TryAssignShiftRejectReason[] = [
  "VACATION",
  "FP",
  "FANI",
  "PREALLOCATION_FIXED",
];

function employeeLabel(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string | null | undefined,
): {
  name: string;
  seniority: number | null;
  poolRank: number | null;
  poolSize: number | null;
} {
  if (!uuid) return { name: "(gap)", seniority: null, poolRank: null, poolSize: null };
  const c = ws.paoEmps.find((p) => p.uuid === uuid);
  if (!c) return { name: uuid, seniority: null, poolRank: null, poolSize: null };
  const pool = ctx.paoPoolSeniorityByEmployee.get(uuid);
  return {
    name: c.employee.name,
    seniority: c.employee.seniority,
    poolRank: pool?.poolRank ?? null,
    poolSize: pool?.poolSize ?? null,
  };
}

function mapRejectReason(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
  day: string,
  shift: ShiftCode,
  holderUuid: string | null,
  evalResult: ReturnType<typeof evaluateTryAssignShiftDetailed>,
): PreferenceDeniedReason {
  if (evalResult.ok) {
    const cur = ctx.currentTurnCounts.get(uuid) ?? 0;
    const min = ctx.minTurnCounts.get(uuid) ?? 0;
    if (cur < min) return "MIN_PROPORCIONAL";
    if (holderUuid && holderUuid !== uuid) return "COBERTURA";
    return "OUTRO";
  }

  switch (evalResult.reason) {
    case "DAY_OCCUPIED":
      return "DAY_OCCUPIED";
    case "MIN_REST":
      return "DESCANSO_12H";
    case "RATEIO_MAX":
      return "MAX_PROPORCIONAL";
    case "PREALLOCATION_FIXED":
    case "VACATION":
    case "FP":
    case "FANI":
    case "SOCIAL_DAY_OFF":
    case "GROUPED_DAY_OFF":
      return "PREALLOCATION";
    case "T6T7_BLOCK_MAX":
      return "OUTRO";
    case "WEEKEND_RULE":
      return "RESTricao";
    case "CAN_WORK_FALSE":
      if (evalResult.details?.toLowerCase().includes("restri")) return "RESTricao";
      if (
        evalResult.details?.includes("limite") ||
        evalResult.details?.includes("budget")
      ) {
        return "MAX_PROPORCIONAL";
      }
      return "OUTRO";
    default:
      break;
  }

  if (
    shift === "T8" &&
    (isNdDayAfterOwnT8Pair(ws, uuid, day) ||
      evalResult.details?.includes("ND") ||
      !ws.canPlaceT8Block(uuid, day, false))
  ) {
    return "T8_PAIR";
  }

  return "OUTRO";
}

function countsAsLostOpportunity(
  evalResult: ReturnType<typeof evaluateTryAssignShiftDetailed>,
): boolean {
  if (evalResult.ok) return true;
  if (evalResult.reason === "DAY_OCCUPIED") return true;
  if (evalResult.reason === "MIN_REST") return true;
  if (evalResult.reason === "T6T7_BLOCK_MAX") return true;
  return false;
}

function countShift(ws: GenerationWorkspace, uuid: string, shift: ShiftCode): number {
  return ws.toAssignments().filter(
    (a) => a.employeeUuid === uuid && a.shiftCode.toUpperCase() === shift,
  ).length;
}

/** Oportunidade perdida = dia com turno preferido ocupado por outro PAO (estado final). */
export function buildPreferenceDeniedAudit(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): PreferenceDeniedEmployeeAudit[] {
  const audits: PreferenceDeniedEmployeeAudit[] = [];

  for (const c of ws.paoEmps) {
    const preferred = ctx.preferredShiftByEmployee.get(c.uuid);
    if (!preferred) continue;

    const uuid = c.uuid;
    const preferredReceived = countShift(ws, uuid, preferred);
    const totalTurns = countRateioTurns(ws, uuid);
    const lostSlots: PreferenceDeniedSlot[] = [];

    for (const day of ws.days) {
      const hasPreferred = ws.toAssignments().some(
        (a) =>
          a.employeeUuid === uuid &&
          a.date === day &&
          a.shiftCode.toUpperCase() === preferred,
      );
      if (hasPreferred) continue;

      const holderUuid = ws.findPaoOnShift(day, preferred) ?? null;
      if (!holderUuid || holderUuid === uuid) continue;

      const evalResult = evaluateTryAssignShiftDetailed(ws, uuid, day, preferred, false);
      if (evalResult.reason != null && HARD_EXCLUDE.includes(evalResult.reason)) continue;
      if (!countsAsLostOpportunity(evalResult)) continue;

      const reason = mapRejectReason(ws, ctx, uuid, day, preferred, holderUuid, evalResult);
      const receiver = employeeLabel(ws, ctx, holderUuid);
      const detail =
        evalResult.ok
          ? `elegível no estado final, mas ${receiver.name} (${formatPaoPoolSeniority(receiver.poolRank != null && receiver.poolSize != null ? { employeeUuid: holderUuid!, cadastralSeniority: receiver.seniority ?? 0, poolRank: receiver.poolRank, poolSize: receiver.poolSize } : undefined)}) ocupa ${preferred}`
          : [evalResult.reason, evalResult.details].filter(Boolean).join(": ");

      lostSlots.push({
        date: day,
        shift: preferred,
        receiverUuid: holderUuid,
        receiverName: receiver.name,
        receiverSeniority: receiver.seniority,
        receiverPoolRank: receiver.poolRank,
        receiverPoolSize: receiver.poolSize,
        reason,
        detail,
      });
    }

    lostSlots.sort((a, b) => ws.days.indexOf(a.date) - ws.days.indexOf(b.date));

    const reasonSummary: Partial<Record<PreferenceDeniedReason, number>> = {};
    for (const slot of lostSlots) {
      reasonSummary[slot.reason] = (reasonSummary[slot.reason] ?? 0) + 1;
    }

    const lost = lostSlots.length;
    const possible = preferredReceived + lost;
    const attendancePercent =
      totalTurns > 0 ? Math.round((preferredReceived / totalTurns) * 100) : 0;
    const opportunityPercent =
      possible > 0 ? Math.round((preferredReceived / possible) * 100) : 0;

    const pool = ctx.paoPoolSeniorityByEmployee.get(uuid);

    audits.push({
      employeeUuid: uuid,
      name: c.employee.name,
      seniority: c.employee.seniority,
      poolRank: pool?.poolRank ?? 0,
      poolSize: pool?.poolSize ?? ws.paoEmps.length,
      preferredShift: preferred,
      totalTurns,
      preferredReceived,
      attendancePercent,
      opportunityPercent,
      possible,
      lost,
      lostSlots,
      reasonSummary,
    });
  }

  return audits.sort(
    (a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function buildSeniorityPreferenceVerdicts(
  audits: PreferenceDeniedEmployeeAudit[],
): SeniorityPreferenceVerdict[] {
  const groups = new Map<ShiftCode, PreferenceDeniedEmployeeAudit[]>();
  for (const a of audits) {
    const list = groups.get(a.preferredShift) ?? [];
    list.push(a);
    groups.set(a.preferredShift, list);
  }

  const order: ShiftCode[] = ["T6", "T7", "T8", "T9"];
  const verdicts: SeniorityPreferenceVerdict[] = [];

  for (const shift of order) {
    const rows = groups.get(shift);
    if (!rows || rows.length === 0) continue;

    const sorted = [...rows].sort(
      (a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"),
    );

    if (sorted.length < 2) {
      const only = sorted[0]!;
      verdicts.push({
        preferredShift: shift,
        rows: sorted.map((r) => ({
          name: r.name,
          seniority: r.seniority,
          poolRank: r.poolRank,
          poolSize: r.poolSize,
          attendancePercent: r.attendancePercent,
          opportunityPercent: r.opportunityPercent,
          received: r.preferredReceived,
          totalTurns: r.totalTurns,
          possible: r.possible,
        })),
        oldest: {
          name: only.name,
          seniority: only.seniority,
          poolRank: only.poolRank,
          poolSize: only.poolSize,
          attendancePercent: only.attendancePercent,
        },
        newest: {
          name: only.name,
          seniority: only.seniority,
          poolRank: only.poolRank,
          poolSize: only.poolSize,
          attendancePercent: only.attendancePercent,
        },
        deltaPercent: 0,
        verdict: "AMOSTRA INSUFICIENTE",
      });
      continue;
    }

    const oldest = sorted[0]!;
    const newest = sorted[sorted.length - 1]!;
    const deltaPercent = oldest.attendancePercent - newest.attendancePercent;

    let verdict: SeniorityPreferenceVerdict["verdict"];
    if (deltaPercent >= 10) {
      verdict = "SENIORIDADE OBSERVADA";
    } else if (deltaPercent <= -10) {
      verdict = "SENIORIDADE NÃO OBSERVADA";
    } else {
      verdict = "SENIORIDADE PARCIALMENTE OBSERVADA";
    }

    verdicts.push({
      preferredShift: shift,
      rows: sorted.map((r) => ({
        name: r.name,
        seniority: r.seniority,
        poolRank: r.poolRank,
        poolSize: r.poolSize,
        attendancePercent: r.attendancePercent,
        opportunityPercent: r.opportunityPercent,
        received: r.preferredReceived,
        totalTurns: r.totalTurns,
        possible: r.possible,
      })),
      oldest: {
        name: oldest.name,
        seniority: oldest.seniority,
        poolRank: oldest.poolRank,
        poolSize: oldest.poolSize,
        attendancePercent: oldest.attendancePercent,
      },
      newest: {
        name: newest.name,
        seniority: newest.seniority,
        poolRank: newest.poolRank,
        poolSize: newest.poolSize,
        attendancePercent: newest.attendancePercent,
      },
      deltaPercent,
      verdict,
    });
  }

  return verdicts;
}

export function formatPreferenceDeniedAudit(audits: PreferenceDeniedEmployeeAudit[]): string {
  const lines: string[] = ["===== PREFERÊNCIA NEGADA =====", ""];

  if (audits.length === 0) {
    lines.push("(nenhum PAO com preferência de turno cadastrada)");
    return lines.join("\n");
  }

  for (const a of audits) {
    lines.push(`${a.name}`);
    lines.push(
      `  Senioridade: cad ${a.seniority} | pool PAO ${a.poolRank}/${a.poolSize}`,
    );
    lines.push(`  Turno preferido: ${a.preferredShift}`);
    lines.push(`  Turnos totais (rateio): ${a.totalTurns}`);
    lines.push(`  Turnos preferidos recebidos: ${a.preferredReceived}`);
    lines.push(
      `  Percentual de atendimento: ${a.attendancePercent}% (${a.preferredReceived}/${a.totalTurns} turnos totais)`,
    );
    lines.push(
      `  Oportunidades possíveis: ${a.possible} (${a.opportunityPercent}% sobre oportunidades)`,
    );
    lines.push(`  Perdidos: ${a.lost}`);
    lines.push("");
    lines.push(`  ${a.name} perdeu ${a.lost} ${a.preferredShift}:`);
    lines.push("  Motivos agregados:");
    const reasons = Object.entries(a.reasonSummary).sort(
      (x, y) => (y[1] as number) - (x[1] as number),
    );
    if (reasons.length === 0) {
      lines.push("    (nenhum slot perdido registrado)");
    } else {
      for (const [reason, count] of reasons) {
        lines.push(`    ${reason}: ${count}`);
      }
    }
    lines.push("");
    lines.push("  Detalhe por turno preferido perdido:");
    if (a.lostSlots.length === 0) {
      lines.push("    (nenhum)");
    } else {
      for (const slot of a.lostSlots) {
        lines.push(`    ${a.name} perdeu ${slot.shift} @ ${slot.date}`);
        lines.push(`      ${slot.date} | ${slot.shift}`);
        lines.push(
          `      Recebeu: ${slot.receiverName} | ${formatPaoPoolSeniority(slot.receiverPoolRank != null && slot.receiverPoolSize != null ? { employeeUuid: slot.receiverUuid ?? "", cadastralSeniority: slot.receiverSeniority ?? 0, poolRank: slot.receiverPoolRank, poolSize: slot.receiverPoolSize } : undefined)}`,
        );
        lines.push(`      Motivo: ${slot.reason}`);
        if (slot.detail) {
          lines.push(`      Detalhe: ${slot.detail}`);
        }
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }

  lines.push("Resumo agregado (todos com preferência):");
  for (const a of audits) {
    lines.push(`${a.name}`);
    lines.push(`  Perdeu ${a.lost} ${a.preferredShift}`);
    lines.push("  Motivos:");
    for (const [reason, count] of Object.entries(a.reasonSummary).sort(
      (x, y) => (y[1] as number) - (x[1] as number),
    )) {
      lines.push(`    ${reason}: ${count}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSeniorityPreferenceVerdicts(
  verdicts: SeniorityPreferenceVerdict[],
): string {
  const lines: string[] = ["===== SENIORIDADE X PREFERÊNCIA =====", ""];

  if (verdicts.length === 0) {
    lines.push("(nenhum PAO com preferência de turno cadastrada)");
    return lines.join("\n");
  }

  for (const v of verdicts) {
    lines.push(`Preferência ${v.preferredShift}:`);
    for (const r of v.rows) {
      lines.push(
        `  ${r.name} (cad ${r.seniority}, pool ${r.poolRank}/${r.poolSize}) → ${r.received}/${r.totalTurns} turnos (${r.attendancePercent}%) | oport ${r.received}/${r.possible} (${r.opportunityPercent}%)`,
      );
    }
    lines.push("");
    if (v.verdict === "AMOSTRA INSUFICIENTE") {
      lines.push(`Resultado: ${v.verdict} (apenas 1 PAO com pref ${v.preferredShift})`);
    } else {
      lines.push(
        `Mais antigo: ${v.oldest.name} (cad ${v.oldest.seniority}, pool ${v.oldest.poolRank}/${v.oldest.poolSize}) → ${v.oldest.attendancePercent}%`,
      );
      lines.push(
        `Mais novo: ${v.newest.name} (cad ${v.newest.seniority}, pool ${v.newest.poolRank}/${v.newest.poolSize}) → ${v.newest.attendancePercent}%`,
      );
      lines.push(`Diferença (antigo − novo): ${v.deltaPercent >= 0 ? "+" : ""}${v.deltaPercent}%`);
      lines.push(`Resultado: ${v.verdict}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
