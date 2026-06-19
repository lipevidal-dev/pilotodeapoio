import { addDays } from "../../rules/dates.js";
import {
  consecutiveWorkCount,
  isProductiveWorkAllocationLabel,
} from "../../rules/consecutive.js";
import { assignmentKey } from "../types.js";
import { CROSS_MONTH_ND_LABEL } from "../operational-labels.js";
import type { GeneratedAllocation } from "../generation-types.js";
import type { CleanWorkspace } from "./clean-workspace.js";
import { isDateBeyondCurrentMonth } from "./clean-cross-month-t8.js";
import { motorRuleEnabled } from "./clean-motor-rules.js";

const PHASE = "CROSS_MONTH_CONTINUITY";

function crossMonthRowExists(
  ws: CleanWorkspace,
  uuid: string,
  date: string,
  label: string,
): boolean {
  const normalized = label.toUpperCase();
  return ws.crossMonthPreAllocations.some(
    (row) =>
      row.employeeUuid === uuid &&
      row.date === date &&
      row.label.toUpperCase() === normalized,
  );
}

function hasCrossMonthFixOnDay(ws: CleanWorkspace, uuid: string, date: string): boolean {
  return ws.crossMonthPreAllocations.some(
    (row) => row.employeeUuid === uuid && row.date === date,
  );
}

/** Dias trabalhados consecutivos imediatamente antes de `day` (histórico + mês corrente). */
export function consecutiveWorkDaysBefore(
  ws: CleanWorkspace,
  uuid: string,
  day: string,
): number {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return 0;
  return consecutiveWorkCount(did, day, ws.mergedPlannedForContinuity(), ws.mergedBlockedForContinuity());
}

/**
 * Folga obrigatória no 1º dia do mês quando o mês anterior encerrou com 6+ dias consecutivos.
 * Espelha enforceMonthStart6x1FromPrevious do motor legado.
 */
export function enforceMonthStartSixByOneFromPrevious(ws: CleanWorkspace): void {
  if (!ws.usesNextMotorRules()) return;
  if (!motorRuleEnabled(ws.options, "max_6_consecutive")) return;
  if (ws.days.length === 0) return;

  const firstDay = ws.days[0]!;
  for (const emp of ws.input.employees) {
    const role = emp.employee.role?.toUpperCase();
    if (role !== "PAO" && role !== "APAO") continue;
    if (consecutiveWorkDaysBefore(ws, emp.uuid, firstDay) < 6) continue;

    const did = emp.domainId;
    if (ws.planned.has(assignmentKey(did, firstDay)) || ws.blocked.has(assignmentKey(did, firstDay))) {
      continue;
    }
    ws.setBlockDay(emp.uuid, firstDay, "FOLGA");
    ws.audit.record("COVERAGE_ASSIGNED", PHASE, "folga 6x1 — continuidade do mês anterior", {
      date: firstDay,
      employeeUuid: emp.uuid,
      employeeName: emp.employee.name,
    });
  }
}

/** Garante T8/T8/ND cruzando o fim do mês: pré-aloca T8 e ND CONTINUIDADE no mês seguinte. */
export function ensureCrossMonthT8Continuations(ws: CleanWorkspace): void {
  const last = ws.days[ws.days.length - 1];
  if (!last) return;

  for (const emp of ws.paoEmployees) {
    const did = emp.domainId;
    if (ws.getShiftOnDay(did, last)?.toUpperCase() !== "T8") continue;

    const prev = addDays(last, -1);
    const d1 = addDays(last, 1);
    const d2 = addDays(last, 2);
    const prevIsT8 = ws.getShiftOnDay(did, prev)?.toUpperCase() === "T8";

    if (prevIsT8) {
      if (!crossMonthRowExists(ws, emp.uuid, d1, CROSS_MONTH_ND_LABEL)) {
        ws.addCrossMonthPreAllocations([
          { employeeUuid: emp.uuid, date: d1, label: CROSS_MONTH_ND_LABEL },
        ]);
        ws.audit.record(
          "T8_ND_APPLIED",
          PHASE,
          "ND CONTINUIDADE pré-alocado após T8/T8 no fim do mês",
          { date: d1, employeeUuid: emp.uuid, employeeName: emp.employee.name },
        );
      }
      continue;
    }

    const rows: GeneratedAllocation[] = [];
    if (!crossMonthRowExists(ws, emp.uuid, d1, "T8")) {
      rows.push({ employeeUuid: emp.uuid, date: d1, label: "T8" });
    }
    if (!crossMonthRowExists(ws, emp.uuid, d2, CROSS_MONTH_ND_LABEL)) {
      rows.push({ employeeUuid: emp.uuid, date: d2, label: CROSS_MONTH_ND_LABEL });
    }
    if (rows.length === 0) continue;

    ws.addCrossMonthPreAllocations(rows);
    ws.audit.record(
      "COVERAGE_ASSIGNED",
      PHASE,
      "continuidade T8/T8/ND fixada no mês seguinte",
      {
        date: last,
        shiftCode: "T8",
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      },
    );
  }
}

/** Pré-aloca folga 6x1 no mês seguinte para quem encerrou o mês com 6 dias consecutivos. */
export function appendCrossMonthSixByOneFolgas(ws: CleanWorkspace): void {
  if (!ws.usesNextMotorRules()) return;
  if (!motorRuleEnabled(ws.options, "max_6_consecutive")) return;

  const last = ws.days[ws.days.length - 1];
  if (!last) return;
  const firstNext = addDays(last, 1);

  for (const emp of ws.input.employees) {
    const role = emp.employee.role?.toUpperCase();
    if (role !== "PAO" && role !== "APAO") continue;
    if (consecutiveWorkDaysBefore(ws, emp.uuid, firstNext) < 6) continue;
    if (hasCrossMonthFixOnDay(ws, emp.uuid, firstNext)) continue;

    ws.addCrossMonthPreAllocations([
      { employeeUuid: emp.uuid, date: firstNext, label: "FOLGA" },
    ]);
    ws.audit.record(
      "COVERAGE_ASSIGNED",
      PHASE,
      "folga 6x1 pré-alocada no mês seguinte",
      {
        date: firstNext,
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      },
    );
  }
}

/** Consolida spillover operacional (T8/ND/folga) para persistência fixa no mês seguinte. */
export function finalizeCrossMonthContinuations(ws: CleanWorkspace): void {
  ensureCrossMonthT8Continuations(ws);
  appendCrossMonthSixByOneFolgas(ws);

  for (const row of [...ws.crossMonthPreAllocations]) {
    if (!isDateBeyondCurrentMonth(ws, row.date)) continue;
    const did = ws.uuidToDomain.get(row.employeeUuid);
    if (did == null) continue;
    const key = assignmentKey(did, row.date);
    const upper = row.label.toUpperCase();
    if (upper === "T8") continue;
    if (isProductiveWorkAllocationLabel(row.label) || upper === "FOLGA") {
      ws.blocked.delete(key);
      ws.removeAllocationForDay(row.employeeUuid, row.date);
    }
  }
}
