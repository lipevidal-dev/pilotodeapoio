import { isoDateKey } from "../../domain/rules/date-keys.js";
import {
  deduplicateOperationalCadastros,
  operationalLabelPriority,
} from "../../domain/rules/operational-cadastro-priority.js";

export type OperationalCadastroSource =
  | "vacation"
  | "requested_day_off"
  | "flight"
  | "pre_allocation";

export interface OperationalCadastroDisplay {
  id: string;
  employeeId: string;
  date: string;
  label: string;
  source: OperationalCadastroSource;
  sourceId?: string;
  priority?: number;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

const PRE_ALLOC_LABELS = new Set(["SIMULADOR", "CURSO", "CMA", "OUTRO", "FOLGA PEDIDA", "FP"]);

function toIsoNoon(date: string): string {
  if (date.includes("T")) return date;
  return `${date}T12:00:00.000Z`;
}

export function buildOperationalCadastroDisplay(input: {
  vacationDays: Array<{ employeeUuid: string; date: string }>;
  approvedDayOffs: Array<{ employeeUuid: string; date: string }>;
  flightDays: Array<{
    id?: string;
    employeeUuid: string;
    date: string;
    description?: string;
    source?: string;
  }>;
  preAllocations: Array<{
    id: string;
    employeeId: string;
    date: Date;
    label: string;
    notes?: string | null;
  }>;
}): OperationalCadastroDisplay[] {
  const out: OperationalCadastroDisplay[] = [];

  for (const v of input.vacationDays) {
    const sourceId = `${v.employeeUuid}|${v.date}`;
    out.push({
      id: `vacation-${sourceId}`,
      employeeId: v.employeeUuid,
      date: toIsoNoon(v.date),
      label: "FÉRIAS",
      source: "vacation",
      sourceId,
      priority: operationalLabelPriority("FÉRIAS"),
    });
  }

  for (const fp of input.approvedDayOffs) {
    const sourceId = `${fp.employeeUuid}|${fp.date}`;
    out.push({
      id: `fp-${sourceId}`,
      employeeId: fp.employeeUuid,
      date: toIsoNoon(fp.date),
      label: "FOLGA PEDIDA",
      source: "requested_day_off",
      sourceId,
      priority: operationalLabelPriority("FOLGA PEDIDA"),
    });
  }

  for (const f of input.flightDays) {
    const sourceId = f.id ?? `flight-${f.employeeUuid}-${f.date}`;
    out.push({
      id: `flight-${sourceId}`,
      employeeId: f.employeeUuid,
      date: toIsoNoon(f.date),
      label: "VOO",
      source: "flight",
      sourceId,
      priority: operationalLabelPriority("VOO"),
      notes: f.description ?? null,
      metadata: f.source ? { flightSource: f.source } : undefined,
    });
  }

  for (const p of input.preAllocations) {
    const label = p.label.toUpperCase();
    if (!PRE_ALLOC_LABELS.has(label) && !label.includes("FOLGA PEDIDA") && label !== "FP") {
      continue;
    }
    const displayLabel = label.includes("FOLGA PEDIDA") || label === "FP" ? "FOLGA PEDIDA" : p.label;
    out.push({
      id: p.id,
      employeeId: p.employeeId,
      date: toIsoNoon(isoDateKey(p.date)),
      label: displayLabel,
      source: "pre_allocation",
      sourceId: p.id,
      priority: operationalLabelPriority(p.label),
      notes: p.notes ?? null,
    });
  }

  return deduplicateOperationalCadastros(out);
}
