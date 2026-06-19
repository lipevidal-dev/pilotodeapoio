import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationInputEmployee } from "../generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { currentTurnCount } from "./schedule-rateio-context.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
import {
  comparePaoPoolSeniority,
  formatPaoPoolSeniority,
  sortPaoByPoolSeniority,
} from "./pao-pool-seniority.js";

export const PREFERENCE_SCORE_BASE = 30;

/** Peso 1.0 (mais novo) … 1.5 (mais antigo) a partir da senioridade relativa entre PAOs. */
export function buildSeniorityWeightIndex(ws: GenerationWorkspace): Map<string, number> {
  const sorted = sortPaoByPoolSeniority(ws);
  const out = new Map<string, number>();
  const n = sorted.length;
  if (n === 0) return out;
  if (n === 1) {
    out.set(sorted[0]!.uuid, 1.5);
    return out;
  }
  for (let i = 0; i < n; i++) {
    const percentile = 1 - i / (n - 1);
    out.set(sorted[i]!.uuid, 1 + 0.5 * percentile);
  }
  return out;
}

export function computePreferenceWeight(
  ws: GenerationWorkspace,
  employeeUuid: string,
  ctx?: ScheduleRateioContext,
): number {
  const cached = ctx?.seniorityWeightByEmployee?.get(employeeUuid);
  if (cached != null) return cached;
  return buildSeniorityWeightIndex(ws).get(employeeUuid) ?? 1;
}

/** Bônus de preferência quando turno === preferência cadastrada. */
export function preferenceScoreForShift(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  employeeUuid: string,
  shift: ShiftCode,
): number {
  const preferred = ctx.preferredShiftByEmployee.get(employeeUuid);
  if (!preferred || preferred !== shift) return 0;
  return PREFERENCE_SCORE_BASE * computePreferenceWeight(ws, employeeUuid, ctx);
}

export function targetTurnDeficit(ctx: ScheduleRateioContext, employeeUuid: string): number {
  const target = ctx.targetTurnCounts.get(employeeUuid) ?? 0;
  return Math.max(0, target - currentTurnCount(ctx, employeeUuid));
}

/** Desempate: maior score vence (retorno negativo = a antes de b). */
export function comparePreferenceSeniorityTieBreak(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  a: GenerationInputEmployee,
  b: GenerationInputEmployee,
  shift?: ShiftCode,
): number {
  const belowMinA = currentTurnCount(ctx, a.uuid) < (ctx.minTurnCounts.get(a.uuid) ?? 0) ? 0 : 1;
  const belowMinB = currentTurnCount(ctx, b.uuid) < (ctx.minTurnCounts.get(b.uuid) ?? 0) ? 0 : 1;
  if (belowMinA !== belowMinB) return belowMinA - belowMinB;

  const targetDefA = targetTurnDeficit(ctx, a.uuid);
  const targetDefB = targetTurnDeficit(ctx, b.uuid);
  if (targetDefA !== targetDefB) return targetDefB - targetDefA;

  if (shift) {
    const prefA = preferenceScoreForShift(ws, ctx, a.uuid, shift);
    const prefB = preferenceScoreForShift(ws, ctx, b.uuid, shift);
    if (prefA !== prefB) return prefB - prefA;
  }

  const curA = currentTurnCount(ctx, a.uuid);
  const curB = currentTurnCount(ctx, b.uuid);
  if (curA !== curB) return curA - curB;

  const senA = a.employee.seniority;
  const senB = b.employee.seniority;
  if (senA !== senB) return comparePaoPoolSeniority(a, b);

  return a.uuid.localeCompare(b.uuid);
}

export interface PreferenceSeniorityAuditRow {
  employeeUuid: string;
  name: string;
  seniority: number;
  poolRank: number;
  poolSize: number;
  seniorityWeight: number;
  preferredShift: ShiftCode | null;
  preferredReceived: number;
  preferredPossible: number;
  attendancePercent: number;
}

export function buildPreferenceSeniorityAudit(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): PreferenceSeniorityAuditRow[] {
  const rows: PreferenceSeniorityAuditRow[] = [];

  for (const c of ws.paoEmps) {
    const preferred = ctx.preferredShiftByEmployee.get(c.uuid) ?? null;
    const weight = computePreferenceWeight(ws, c.uuid, ctx);
    const pool = ctx.paoPoolSeniorityByEmployee.get(c.uuid);
    const possible = countRateioTurns(ws, c.uuid);
    let received = 0;
    if (preferred) {
      received = ws.toAssignments().filter(
        (a) => a.employeeUuid === c.uuid && a.shiftCode.toUpperCase() === preferred,
      ).length;
    }
    const attendancePercent =
      preferred && possible > 0 ? Math.round((received / possible) * 100) : preferred ? 0 : 100;

    rows.push({
      employeeUuid: c.uuid,
      name: c.employee.name,
      seniority: c.employee.seniority,
      poolRank: pool?.poolRank ?? 0,
      poolSize: pool?.poolSize ?? ws.paoEmps.length,
      seniorityWeight: weight,
      preferredShift: preferred,
      preferredReceived: received,
      preferredPossible: possible,
      attendancePercent,
    });
  }

  return rows.sort(
    (a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export interface PreferenceQuartileSummary {
  superior: number;
  intermediate: number;
  inferior: number;
  sampleSize: number;
}

/** Média de atendimento da preferência por terço de senioridade (1=mais antigo). */
export function buildPreferenceQuartileSummary(
  rows: PreferenceSeniorityAuditRow[],
): PreferenceQuartileSummary {
  const withPref = rows.filter((r) => r.preferredShift);
  const n = withPref.length;
  if (n === 0) {
    return { superior: 0, intermediate: 0, inferior: 0, sampleSize: 0 };
  }

  const sorted = [...withPref].sort(
    (a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"),
  );
  const third = Math.max(1, Math.ceil(n / 3));
  const superiorRows = sorted.slice(0, third);
  const intermediateRows = sorted.slice(third, 2 * third);
  const inferiorRows = sorted.slice(2 * third);

  const avg = (subset: PreferenceSeniorityAuditRow[]) => {
    if (subset.length === 0) return 0;
    return Math.round(
      subset.reduce((sum, r) => sum + r.attendancePercent, 0) / subset.length,
    );
  };

  return {
    superior: avg(superiorRows),
    intermediate: avg(intermediateRows.length > 0 ? intermediateRows : superiorRows),
    inferior: avg(inferiorRows.length > 0 ? inferiorRows : sorted.slice(-third)),
    sampleSize: n,
  };
}

export function formatPreferenceSeniorityAudit(rows: PreferenceSeniorityAuditRow[]): string {
  const lines: string[] = [
    "===== PREFERÊNCIA X SENIORIDADE =====",
    "Nome | Cadastral | Pool PAO | Peso | Preferência | Recebidos | Possíveis | Atendimento",
  ];
  for (const r of rows) {
    if (!r.preferredShift) continue;
    lines.push(
      `${r.name} | ${r.seniority} | ${r.poolRank}/${r.poolSize} | ${r.seniorityWeight.toFixed(2)} | ${r.preferredShift} | ` +
        `${r.preferredReceived} | ${r.preferredPossible} | ${r.attendancePercent}%`,
    );
  }
  if (lines.length === 2) {
    lines.push("(nenhum PAO com preferência de turno cadastrada)");
  } else {
    const quartiles = buildPreferenceQuartileSummary(rows);
    if (quartiles.sampleSize >= 3) {
      lines.push("");
      lines.push("Média de atendimento por terço de senioridade:");
      lines.push(`Quartil superior (mais antigos): ${quartiles.superior}%`);
      lines.push(`Quartil intermediário: ${quartiles.intermediate}%`);
      lines.push(`Quartil inferior (mais novos): ${quartiles.inferior}%`);
    }
  }
  return lines.join("\n");
}

export interface TurnPreferenceValidationRow {
  employeeUuid: string;
  name: string;
  seniority: number;
  poolRank: number;
  poolSize: number;
  preferredShift: ShiftCode | null;
  totalTurns: number;
  t6: number;
  t7: number;
  t8: number;
  t9: number;
  preferredReceived: number;
  attendancePercent: number | null;
}

function countShiftForEmployee(
  ws: GenerationWorkspace,
  uuid: string,
  code: ShiftCode,
): number {
  return ws.toAssignments().filter(
    (a) => a.employeeUuid === uuid && a.shiftCode.toUpperCase() === code,
  ).length;
}

/** Diagnóstico objetivo — preferência cadastrada vs turnos recebidos (julho/debug). */
export function buildTurnPreferenceValidation(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): TurnPreferenceValidationRow[] {
  const rows: TurnPreferenceValidationRow[] = [];

  for (const c of ws.paoEmps) {
    const preferred = ctx.preferredShiftByEmployee.get(c.uuid) ?? null;
    const t6 = countShiftForEmployee(ws, c.uuid, "T6");
    const t7 = countShiftForEmployee(ws, c.uuid, "T7");
    const t8 = countShiftForEmployee(ws, c.uuid, "T8");
    const t9 = countShiftForEmployee(ws, c.uuid, "T9");
    const totalTurns = countRateioTurns(ws, c.uuid);
    const preferredReceived = preferred ? countShiftForEmployee(ws, c.uuid, preferred) : 0;
    const attendancePercent =
      preferred && totalTurns > 0
        ? Math.round((preferredReceived / totalTurns) * 100)
        : preferred
          ? 0
          : null;

    const pool = ctx.paoPoolSeniorityByEmployee.get(c.uuid);

    rows.push({
      employeeUuid: c.uuid,
      name: c.employee.name,
      seniority: c.employee.seniority,
      poolRank: pool?.poolRank ?? 0,
      poolSize: pool?.poolSize ?? ws.paoEmps.length,
      preferredShift: preferred,
      totalTurns,
      t6,
      t7,
      t8,
      t9,
      preferredReceived,
      attendancePercent,
    });
  }

  return rows.sort((a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"));
}

export function formatTurnPreferenceValidation(rows: TurnPreferenceValidationRow[]): string {
  const poolSize = rows[0]?.poolSize ?? 0;
  const lines: string[] = [
    "===== VALIDAÇÃO DE PREFERÊNCIA DE TURNO =====",
    "",
    `Pool PAO: ${poolSize} funcionário(s) — APAO excluído da senioridade de alocação.`,
    "Por PAO (ordem: posição no pool PAO — 1 = mais antigo):",
    "Nome | cadastral | pool | pref | total | T6 | T7 | T8 | T9 | preferidos | atendimento",
  ];

  const withPref = rows.filter((r) => r.preferredShift);
  const withoutPref = rows.filter((r) => !r.preferredShift);

  for (const r of rows) {
    const prefLabel = r.preferredShift ?? "-";
    const prefRatio =
      r.preferredShift != null
        ? `${r.preferredReceived}/${r.totalTurns}`
        : "-";
    const pctLabel =
      r.attendancePercent != null ? `${r.attendancePercent}%` : "n/a";
    lines.push(
      `${r.name} | cad ${r.seniority} | ${r.poolRank}/${r.poolSize} | pref ${prefLabel} | total ${r.totalTurns} | ` +
        `T6 ${r.t6} | T7 ${r.t7} | T8 ${r.t8} | T9 ${r.t9} | preferidos ${prefRatio} | ${pctLabel}`,
    );
  }

  if (withoutPref.length > 0) {
    lines.push("");
    lines.push(`PAOs sem preferência cadastrada (${withoutPref.length}):`);
    for (const r of withoutPref) {
      lines.push(
        `  ${r.name} (cad ${r.seniority}, pool ${r.poolRank}/${r.poolSize}) — total ${r.totalTurns} | T6 ${r.t6} T7 ${r.t7} T8 ${r.t8} T9 ${r.t9}`,
      );
    }
  }

  lines.push("");
  lines.push("Ranking por preferência (senioridade crescente dentro de cada grupo):");

  const prefGroups = new Map<ShiftCode, TurnPreferenceValidationRow[]>();
  for (const r of withPref) {
    const code = r.preferredShift!;
    const group = prefGroups.get(code) ?? [];
    group.push(r);
    prefGroups.set(code, group);
  }

  const prefOrder: ShiftCode[] = ["T6", "T7", "T8", "T9"];
  let anyGroup = false;
  for (const code of prefOrder) {
    const group = prefGroups.get(code);
    if (!group || group.length === 0) continue;
    anyGroup = true;
    lines.push("");
    lines.push(`Preferência ${code}:`);
    const sorted = [...group].sort(
      (a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"),
    );
    sorted.forEach((r, i) => {
      lines.push(
        `${i + 1}. ${r.name} — ${r.preferredReceived}/${r.totalTurns} — ${r.attendancePercent ?? 0}% (cad ${r.seniority}, pool ${r.poolRank}/${r.poolSize})`,
      );
    });
  }

  if (!anyGroup) {
    lines.push("(nenhum PAO com preferência de turno cadastrada)");
  } else if (withPref.length >= 2) {
    const byPool = [...withPref].sort((a, b) => a.poolRank - b.poolRank);
    const oldest = byPool[0]!;
    const newest = byPool[byPool.length - 1]!;
    lines.push("");
    lines.push("Leitura senioridade (pool PAO):");
    lines.push(
      `  Mais antigo com pref: ${oldest.name} (${formatPaoPoolSeniority({ employeeUuid: oldest.employeeUuid, cadastralSeniority: oldest.seniority, poolRank: oldest.poolRank, poolSize: oldest.poolSize })}) — ${oldest.attendancePercent ?? 0}%`,
    );
    lines.push(
      `  Mais novo com pref: ${newest.name} (${formatPaoPoolSeniority({ employeeUuid: newest.employeeUuid, cadastralSeniority: newest.seniority, poolRank: newest.poolRank, poolSize: newest.poolSize })}) — ${newest.attendancePercent ?? 0}%`,
    );
  }

  return lines.join("\n");
}
