import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { evaluateTryAssignShiftDetailed } from "./try-assign-shift-detailed.js";
import type { ValidationIssue } from "./types.js";

export interface V5FillPreferenceDilutionLog {
  date: string;
  allocatedShift: string;
  employeeName: string;
  preferredShift: string;
  hadPreferredSlot: boolean;
  reason: string;
}

export function clearV5FillPreferenceAudit(ws: GenerationWorkspace): void {
  ws.v5FillPreferenceDilutionLog.length = 0;
}

/** Dias do mês em que o PAO poderia receber o turno preferido (read-only). */
export function listViablePreferredSlotDays(
  ws: GenerationWorkspace,
  uuid: string,
  preferred: ShiftCode,
): string[] {
  const days: string[] = [];
  if (preferred === "T8") {
    for (const day of ws.days) {
      if (ws.findPaoOnShift(day, "T8")) continue;
      if (ws.canPlaceT8Block(uuid, day, false)) {
        days.push(day);
        continue;
      }
      if (evaluateTryAssignShiftDetailed(ws, uuid, day, "T8", false).ok) {
        days.push(day);
      }
    }
    return days;
  }

  for (const day of ws.days) {
    if (ws.findPaoOnShift(day, preferred)) continue;
    if (evaluateTryAssignShiftDetailed(ws, uuid, day, preferred, false).ok) {
      days.push(day);
    }
  }
  return days;
}

export function hasViablePreferredSlotRemaining(
  ws: GenerationWorkspace,
  uuid: string,
  preferred: ShiftCode,
): boolean {
  return listViablePreferredSlotDays(ws, uuid, preferred).length > 0;
}

/** Resumo de por que slots preferidos restantes não foram usados (auditoria). */
export function summarizePreferredSlotExhaustion(
  ws: GenerationWorkspace,
  uuid: string,
  preferred: ShiftCode,
): string {
  const viable = listViablePreferredSlotDays(ws, uuid, preferred);
  if (viable.length > 0) {
    const sample = viable.slice(0, 3).map((d) => `${d}: elegível`).join("; ");
    return viable.length > 3 ? `${sample}; +${viable.length - 3} dia(s)` : sample;
  }

  const failures: string[] = [];
  for (const day of ws.days) {
    if (ws.findPaoOnShift(day, preferred)) continue;
    const detail = evaluateTryAssignShiftDetailed(ws, uuid, day, preferred, false);
    if (!detail.ok) {
      failures.push(`${day}: ${detail.reason ?? "UNKNOWN"}${detail.details ? ` (${detail.details})` : ""}`);
    }
    if (failures.length >= 4) break;
  }
  if (failures.length === 0) {
    return `nenhum slot ${preferred} livre no mês (cobertura completa)`;
  }
  return failures.join("; ");
}

export function recordV5FillPreferenceDilution(
  ws: GenerationWorkspace,
  entry: V5FillPreferenceDilutionLog,
  warnings: ValidationIssue[],
): void {
  ws.v5FillPreferenceDilutionLog.push(entry);
  warnings.push({
    severity: "MÉDIA",
    level: "WARNING",
    type: "V5_FILL_PREFERENCE_DILUTION",
    date: entry.date,
    employee: entry.employeeName,
    detail:
      `Fill ${entry.allocatedShift} em ${entry.date} (pref ${entry.preferredShift}) — ` +
      `slot pref=${entry.hadPreferredSlot ? "sim" : "não"}; ${entry.reason}`,
  });
}

export function formatV5FillPreferenceDilutionAudit(ws: GenerationWorkspace): string {
  const lines: string[] = [
    "===== FILL DILUIÇÃO DE PREFERÊNCIA =====",
    "",
  ];

  if (ws.v5FillPreferenceDilutionLog.length === 0) {
    lines.push("(nenhuma diluição de preferência no fill complementar)");
    return lines.join("\n");
  }

  lines.push("data | turno alocado | funcionário | preferência | havia slot preferido? | motivo");
  for (const row of ws.v5FillPreferenceDilutionLog) {
    lines.push(
      `${row.date} | ${row.allocatedShift} | ${row.employeeName} | ${row.preferredShift} | ` +
        `${row.hadPreferredSlot ? "sim" : "não"} | ${row.reason}`,
    );
  }
  return lines.join("\n");
}
