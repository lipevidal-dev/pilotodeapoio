import { isWeekend } from "../rules/dates.js";
import { canWork } from "../rules/eligibility.js";
import { has12hRest } from "../rules/time.js";
import { FANI_LABEL } from "../rules/birthday.js";
import { IDEAL_PAO_REST_COUNT } from "../rules/constants.js";
import { countPrimaryRateioTurns } from "./pao-rateio-shifts.js";
import { normalizeOperationalLabel } from "./operational-labels.js";
import {
  canAssignShiftWithRateio,
  type ShiftCode,
} from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { vacationDaysForPao } from "./pao-operational-priority.js";
import { buildTurnRateioAudit } from "./turn-rateio-audit.js";

export type RefusalReasonCode =
  | "DESCANSO_12H"
  | "FERIAS"
  | "FP"
  | "FANI"
  | "PREALOCACAO_FIXA"
  | "RATEIO_MAX"
  | "TURNO_NAO_PERMITIDO"
  | "T8_BLOCK_IMPOSSIVEL"
  | "SLOT_OCUPADO"
  | "OUTRO";

export interface DayRefusalAttempt {
  day: string;
  shift: ShiftCode;
  reason: RefusalReasonCode;
  detail?: string;
}

export interface PaoBelowTargetDiagnostic {
  employeeUuid: string;
  employeeName: string;
  currentTurns: number;
  minTurns: number;
  targetTurns: number;
  maxTurns: number;
  calendarAvailableDays: number;
  relativeAvailability: number;
  emptyDaysRemaining: number;
  vacationDays: string[];
  fpDays: string[];
  faniDays: string[];
  weekdayBlocks: string[];
  shiftRestrictions: string[];
  preferredShift: string | null;
  preAllocations: Array<{ date: string; label: string }>;
  refusalAttempts: DayRefusalAttempt[];
  refusalSummary: Partial<Record<RefusalReasonCode, number>>;
  hasRealAvailability: boolean;
  summary: string;
}

const COVERAGE_SHIFTS: ShiftCode[] = ["T6", "T7", "T8"];

function blockLabelForDay(ws: GenerationWorkspace, uuid: string, day: string): string | null {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return null;
  return ws.blocked.get(`${did}|${day}`) ?? null;
}

function mergedPlanned(ws: GenerationWorkspace) {
  const out = new Map(ws.planned);
  for (const [k, v] of ws.historyPlanned) out.set(k, v);
  return out;
}

function classifyBlockLabel(label: string): RefusalReasonCode | null {
  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (upper === "FÉRIAS" || upper.includes("FÉRIAS")) return "FERIAS";
  if (upper.includes("FOLGA PEDIDA") || upper === "FP") return "FP";
  if (upper.includes("FOLGA ANIVERS") || upper === "FANI") return "FANI";
  if (
    upper === "SIMULADOR" ||
    upper === "VOO" ||
    upper === "CURSO" ||
    upper === "CURSO ONLINE" ||
    upper === "CMA" ||
    upper === "OUTRO"
  ) {
    return "PREALOCACAO_FIXA";
  }
  return null;
}

function classifyDayRefusal(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
  day: string,
  shift: ShiftCode,
): DayRefusalAttempt {
  const emp = ws.input.employees.find((e) => e.uuid === uuid)!.employee;
  const did = ws.uuidToDomain.get(uuid)!;

  if (!ws.isPaoDayEmpty(uuid, day)) {
    const label = blockLabelForDay(ws, uuid, day);
    if (label) {
      const coded = classifyBlockLabel(label);
      if (coded) return { day, shift, reason: coded, detail: label };
    }
    if (ws.planned.has(`${did}|${day}`)) {
      return { day, shift, reason: "SLOT_OCUPADO", detail: "turno já alocado" };
    }
    if (ws.isLockedByAdmin(uuid, day)) {
      return { day, shift, reason: "PREALOCACAO_FIXA", detail: label ?? "bloqueio admin" };
    }
    return { day, shift, reason: "OUTRO", detail: label ?? "dia ocupado" };
  }

  if (ws.isLockedByAdmin(uuid, day)) {
    const label = blockLabelForDay(ws, uuid, day);
    return {
      day,
      shift,
      reason: "PREALOCACAO_FIXA",
      detail: label ?? "pré-alocação fixa",
    };
  }

  const blockLabel = blockLabelForDay(ws, uuid, day);
  if (blockLabel) {
    const coded = classifyBlockLabel(blockLabel);
    if (coded) return { day, shift, reason: coded, detail: blockLabel };
    if (ws.isDayBlockedForShift(uuid, day)) {
      return { day, shift, reason: "PREALOCACAO_FIXA", detail: blockLabel };
    }
  }

  if (ws.isDayBlockedForShift(uuid, day)) {
    return { day, shift, reason: "OUTRO", detail: blockLabel ?? "bloqueio operacional" };
  }

  const shiftInfo = ws.shiftMap[shift];
  if (shiftInfo?.noWeekends && isWeekend(day)) {
    return {
      day,
      shift,
      reason: "TURNO_NAO_PERMITIDO",
      detail: `${shift} não permitido em fim de semana`,
    };
  }

  const restricted = ws.input.shiftRestrictions?.get(did);
  if (restricted?.has(shift)) {
    return {
      day,
      shift,
      reason: "TURNO_NAO_PERMITIDO",
      detail: `restrição cadastral em ${shift}`,
    };
  }

  const current = ctx.currentTurnCounts.get(uuid) ?? 0;
  const max = ctx.maxTurnCounts.get(uuid);
  const rateio = canAssignShiftWithRateio({
    monthDays: ws.days.length,
    day: ws.days.indexOf(day) + 1,
    shift,
    employeeId: uuid,
    currentTurnCounts: ctx.currentTurnCounts,
    maxTurnCounts: ctx.maxTurnCounts,
    minTurnCounts: ctx.minTurnCounts,
    targetTurnCounts: ctx.targetTurnCounts,
    t6Counts: ctx.currentT6Counts,
    t7Counts: ctx.currentT7Counts,
    t8Counts: ctx.currentT8Counts,
    t9Counts: ctx.currentT9Counts,
    preferredShiftByEmployee: ctx.preferredShiftByEmployee,
    strictMaxTurnCount: true,
    allowEmergencyOverflow: false,
  });
  if (!rateio.allowed) {
    return {
      day,
      shift,
      reason: "RATEIO_MAX",
      detail: max != null ? `${current}/${max} turnos` : rateio.reasons.join(", "),
    };
  }

  const continuity = mergedPlanned(ws);
  const work = canWork(emp, day, shift, ws.blocked, continuity, ws.canWorkOpts);
  if (!work.ok) {
    return { day, shift, reason: "TURNO_NAO_PERMITIDO", detail: work.reason };
  }

  const rest = has12hRest(did, day, shift, continuity, ws.shiftMap, ws.timedOccupancies);
  if (!rest.ok) {
    return { day, shift, reason: "DESCANSO_12H", detail: rest.reason };
  }

  if (shift === "T8" && !ws.canPlaceT8Block(uuid, day, false)) {
    return {
      day,
      shift,
      reason: "T8_BLOCK_IMPOSSIVEL",
      detail: "bloco T8/T8/ND inviável a partir deste dia",
    };
  }

  const budget = countPrimaryRateioTurns(ws, uuid) + 1 + ws.countNd(uuid) + IDEAL_PAO_REST_COUNT;
  if (budget > ws.days.length) {
    return { day, shift, reason: "OUTRO", detail: "cota mensal esgotada (turnos+ND+folgas)" };
  }

  const maxWork = ws.maxWorkDaysForPao(uuid);
  if (maxWork != null && countPrimaryRateioTurns(ws, uuid) >= maxWork) {
    return { day, shift, reason: "OUTRO", detail: `limite ${maxWork} turnos (mês parcial)` };
  }

  return { day, shift, reason: "OUTRO", detail: "elegível — motor não alocou" };
}

function collectWeekdayBlocks(ws: GenerationWorkspace, uuid: string): string[] {
  const blocked: string[] = [];
  const weekdayNames = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  for (const shift of COVERAGE_SHIFTS) {
    const info = ws.shiftMap[shift];
    if (!info?.noWeekends) continue;
    for (const day of ws.days) {
      if (!isWeekend(day)) continue;
      if (ws.isPaoDayEmpty(uuid, day)) {
        blocked.push(`${day} (${weekdayNames[new Date(`${day}T12:00:00`).getDay()]}) → ${shift}`);
      }
    }
  }
  return [...new Set(blocked)].sort();
}

function collectPreAllocations(
  ws: GenerationWorkspace,
  uuid: string,
): Array<{ date: string; label: string }> {
  const out: Array<{ date: string; label: string }> = [];
  for (const lock of ws.input.lockedAllocations) {
    if (lock.employeeUuid === uuid) {
      out.push({ date: lock.date, label: lock.label });
    }
  }
  for (const al of ws.allocations) {
    if (al.employeeUuid === uuid) {
      out.push({ date: al.date, label: al.label });
    }
  }
  return out.sort((a, b) => ws.days.indexOf(a.date) - ws.days.indexOf(b.date));
}

function collectFpDays(ws: GenerationWorkspace, uuid: string): string[] {
  return ws.allocations
    .filter((a) => a.employeeUuid === uuid && normalizeOperationalLabel(a.label).toUpperCase().includes("FOLGA PEDIDA"))
    .map((a) => a.date)
    .sort((a, b) => ws.days.indexOf(a) - ws.days.indexOf(b));
}

function collectFaniDays(ws: GenerationWorkspace, uuid: string): string[] {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return [];
  return ws.days.filter((d) => ws.blocked.get(`${did}|${d}`) === FANI_LABEL);
}

function buildRefusalAttempts(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
): DayRefusalAttempt[] {
  const attempts: DayRefusalAttempt[] = [];
  const emptyDays = ws.emptyDaysForPao(uuid);

  for (const day of emptyDays) {
    let best: DayRefusalAttempt | null = null;
    for (const shift of COVERAGE_SHIFTS) {
      const attempt = classifyDayRefusal(ws, ctx, uuid, day, shift);
      if (attempt.reason === "OUTRO" && attempt.detail?.startsWith("elegível")) {
        best = attempt;
        break;
      }
      if (!best || priorityOf(attempt.reason) < priorityOf(best.reason)) {
        best = attempt;
      }
    }
    if (best) attempts.push(best);
  }

  return attempts;
}

function priorityOf(code: RefusalReasonCode): number {
  const order: RefusalReasonCode[] = [
    "FERIAS",
    "FP",
    "FANI",
    "PREALOCACAO_FIXA",
    "SLOT_OCUPADO",
    "RATEIO_MAX",
    "TURNO_NAO_PERMITIDO",
    "DESCANSO_12H",
    "T8_BLOCK_IMPOSSIVEL",
    "OUTRO",
  ];
  const idx = order.indexOf(code);
  return idx >= 0 ? idx : order.length;
}

function summarizeRefusals(
  attempts: DayRefusalAttempt[],
): Partial<Record<RefusalReasonCode, number>> {
  const summary: Partial<Record<RefusalReasonCode, number>> = {};
  for (const a of attempts) {
    summary[a.reason] = (summary[a.reason] ?? 0) + 1;
  }
  return summary;
}

function buildSummary(d: PaoBelowTargetDiagnostic): string {
  if (d.currentTurns >= d.minTurns) {
    return "Compatível com meta proporcional à disponibilidade.";
  }

  if (d.calendarAvailableDays <= d.minTurns + 2) {
    return `Turnos (${d.currentTurns}) compatíveis com baixa disponibilidade calendário (${d.calendarAvailableDays} dia(s)).`;
  }

  if (d.hasRealAvailability) {
    const elegiveis = d.refusalAttempts.filter((a) => a.detail?.startsWith("elegível")).length;
    if (elegiveis > 0) {
      return `${elegiveis} dia(s) livre(s) elegível(is) — motor deveria priorizar este PAO.`;
    }
    return "Dias livres existem, mas bloqueados por regras operacionais/rateio.";
  }
  const top = Object.entries(d.refusalSummary).sort((a, b) => b[1]! - a[1]!)[0];
  if (top) {
    return `Sem disponibilidade real — principal bloqueio: ${top[0]} (${top[1]} dia(s)).`;
  }
  return "Sem dias livres no mês.";
}

export function buildPaoBelowTargetDiagnostics(ws: GenerationWorkspace): PaoBelowTargetDiagnostic[] {
  const ctx = ws.rateioContext ?? ws.ensureRateioContext();
  const audits = buildTurnRateioAudit(ws, ctx);
  const below = audits.filter((a) => a.belowMin);

  return below.map((a) => {
    const uuid = a.employeeId;
    const emptyDays = ws.emptyDaysForPao(uuid);
    const refusalAttempts = buildRefusalAttempts(ws, ctx, uuid);
    const refusalSummary = summarizeRefusals(refusalAttempts);
    const hasRealAvailability = refusalAttempts.some((r) => r.detail?.startsWith("elegível"));

    const did = ws.uuidToDomain.get(uuid);
    const restrictions = did
      ? [...(ws.input.shiftRestrictions?.get(did) ?? new Set<string>())].sort()
      : [];
    const preferred = ctx.preferredShiftByEmployee.get(uuid) ?? null;

    const diagnostic: PaoBelowTargetDiagnostic = {
      employeeUuid: uuid,
      employeeName: a.employeeName,
      currentTurns: a.totalTurns,
      minTurns: a.minTurns,
      targetTurns: a.targetTurns,
      maxTurns: a.maxTurns,
      calendarAvailableDays: a.availableDays,
      relativeAvailability: a.relativeAvailability,
      emptyDaysRemaining: emptyDays.length,
      vacationDays: vacationDaysForPao(ws, uuid),
      fpDays: collectFpDays(ws, uuid),
      faniDays: collectFaniDays(ws, uuid),
      weekdayBlocks: collectWeekdayBlocks(ws, uuid),
      shiftRestrictions: restrictions,
      preferredShift: preferred,
      preAllocations: collectPreAllocations(ws, uuid),
      refusalAttempts,
      refusalSummary,
      hasRealAvailability,
      summary: "",
    };
    diagnostic.summary = buildSummary(diagnostic);
    return diagnostic;
  });
}

export function formatPaoBelowTargetDiagnostics(diagnostics: PaoBelowTargetDiagnostic[]): string {
  const lines: string[] = ["===== PAOS ABAIXO DA META — DIAGNÓSTICO ====="];

  if (diagnostics.length === 0) {
    lines.push("(nenhum PAO abaixo do mínimo de turnos)");
    return lines.join("\n");
  }

  for (const d of diagnostics) {
    lines.push("");
    lines.push(
      `▶ ${d.employeeName} — ${d.currentTurns}/${d.minTurns} turnos (min prop.), target ${d.targetTurns.toFixed(1)}, max ${d.maxTurns}`,
    );
    lines.push(
      `  Dias disponíveis (calendário): ${d.calendarAvailableDays}; relativo: ${d.relativeAvailability.toFixed(2)}`,
    );
    lines.push(`  Dias livres restantes: ${d.emptyDaysRemaining}`);
    lines.push(`  Férias: ${d.vacationDays.length ? d.vacationDays.join(", ") : "(nenhuma)"}`);
    lines.push(`  FP: ${d.fpDays.length ? d.fpDays.join(", ") : "(nenhuma)"}`);
    lines.push(`  FANI: ${d.faniDays.length ? d.faniDays.join(", ") : "(nenhuma)"}`);
    lines.push(
      `  Bloqueios fim de semana: ${d.weekdayBlocks.length ? d.weekdayBlocks.join("; ") : "(nenhum)"}`,
    );
    lines.push(
      `  Restrições de turno: ${d.shiftRestrictions.length ? d.shiftRestrictions.join(", ") : "(nenhuma)"}`,
    );
    lines.push(`  Preferência de turno: ${d.preferredShift ?? "(nenhuma)"}`);
    lines.push(
      `  Pré-alocações: ${
        d.preAllocations.length
          ? d.preAllocations.map((p) => `${p.date}=${p.label}`).join(", ")
          : "(nenhuma)"
      }`,
    );
    lines.push(`  Conclusão: ${d.summary}`);

    if (d.refusalSummary && Object.keys(d.refusalSummary).length > 0) {
      lines.push("  Motivos de recusa (resumo):");
      for (const [code, count] of Object.entries(d.refusalSummary).sort(
        (a, b) => b[1]! - a[1]!,
      )) {
        lines.push(`    ${code}: ${count}`);
      }
    }

    const sample = d.refusalAttempts.slice(0, 12);
    if (sample.length > 0) {
      lines.push("  Tentativas por dia livre (amostra):");
      for (const a of sample) {
        lines.push(`    ${a.day} ${a.shift} → ${a.reason}${a.detail ? ` (${a.detail})` : ""}`);
      }
      if (d.refusalAttempts.length > sample.length) {
        lines.push(`    … +${d.refusalAttempts.length - sample.length} dia(s)`);
      }
    }
  }

  return lines.join("\n");
}
