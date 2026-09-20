import { addDays } from "../../rules/dates.js";
import { birthdayInMonth, FANI_LABEL } from "../../rules/birthday.js";
import type { ValidationIssue } from "../types.js";
import { normalizeOperationalLabel } from "../operational-labels.js";
import type { CleanWorkspace } from "./clean-workspace.js";

function isFaniLabel(label: string): boolean {
  const upper = normalizeOperationalLabel(label).toUpperCase();
  return upper === FANI_LABEL.toUpperCase() || upper === "FANI";
}

function blockLabelOnDay(ws: CleanWorkspace, domainId: number, day: string): string | undefined {
  return ws.getBlockLabel(domainId, day);
}

/** Folga automática de aniversário (FANI) — após bloqueios de maior prioridade. */
export function applyBirthdayFolgas(ws: CleanWorkspace): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  for (const ge of ws.input.employees) {
    const day = birthdayInMonth(ge.employee.birthDate, ws.input.year, ws.input.month);
    if (!day) continue;

    const did = ws.uuidToDomain.get(ge.uuid);
    if (did == null) continue;

    const existing = blockLabelOnDay(ws, did, day);
    if (existing) {
      if (!isFaniLabel(existing)) {
        warnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "FANI CONFLITO",
          date: day,
          employee: ge.employee.name,
          detail: `Aniversário em ${day} não gerou FANI — dia bloqueado por ${existing}.`,
        });
      }
      continue;
    }

    ws.setBlockDay(ge.uuid, day, FANI_LABEL);
    ws.audit.record("APPLY_FANI", "BIRTHDAY", "folga de aniversário", {
      date: day,
      employeeUuid: ge.uuid,
      employeeName: ge.employee.name,
    });
  }
  return warnings;
}

/** Folga obrigatória no dia seguinte a FANI (continuidade entre meses). */
export function applyPostFaniRestDays(ws: CleanWorkspace): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  for (const ge of ws.input.employees) {
    const did = ws.uuidToDomain.get(ge.uuid);
    if (did == null) continue;

    for (const day of ws.days) {
      const prev = addDays(day, -1);
      const prevLabel = blockLabelOnDay(ws, did, prev);
      if (!prevLabel || !isFaniLabel(prevLabel)) continue;

      const existing = blockLabelOnDay(ws, did, day);
      if (existing) {
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

      ws.setBlockDay(ge.uuid, day, "FOLGA");
      ws.audit.record("APPLY_POST_FANI", "BIRTHDAY", "folga após FANI", {
        date: day,
        employeeUuid: ge.uuid,
        employeeName: ge.employee.name,
      });
    }
  }
  return warnings;
}
