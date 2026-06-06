import type { Employee } from "../employee/types.js";
import type { ShiftMap } from "../shift/types.js";
import type { BlockedMap, PlannedMap, ScheduleContext } from "../schedule/types.js";
import { assignmentKey } from "../schedule/types.js";
import {
  isOperationalHardBlock,
  normalizeOperationalLabel,
} from "../schedule/operational-labels.js";
import { PROTECTED_PREALLOC_TYPES } from "./constants.js";
import {
  apaoHasNoOtherApaoOverlap,
  buildPlannedWithHistory,
  consecutiveWorkCount,
} from "./consecutive.js";
import { buildRoleMap, buildShiftMapFromContext } from "./coverage.js";
import { intervalCoveredByPao } from "./pao-interval.js";
import { isEmployeeInPlanning } from "./vacation.js";
import { isWeekend } from "./dates.js";
import {
  has12hRest,
  maxSimultaneousWorkersIfAdded,
  roleForShift,
  shiftStartEnd,
  t8PreviousCount,
} from "./time.js";

export interface CanWorkOptions {
  shiftMap: ShiftMap;
  shiftRestrictions?: Map<number, Set<string>>;
  roleByEmployeeId: Map<number, string>;
  maxMonthlyWork?: number;
  coverageEmergency?: boolean;
}

function monthlyWorkCount(employeeId: number, planned: PlannedMap): number {
  let n = 0;
  for (const key of planned.keys()) {
    if (key.startsWith(`${employeeId}|`)) n++;
  }
  return n;
}

function isProtectedPrealloc(type: string): boolean {
  return PROTECTED_PREALLOC_TYPES.has(normalizeOperationalLabel(type).toUpperCase());
}

export function canWork(
  employee: Employee,
  workDay: string,
  shiftCode: string,
  blocked: BlockedMap,
  planned: PlannedMap,
  options: CanWorkOptions,
): { ok: boolean; reason: string } {
  const {
    shiftMap,
    shiftRestrictions,
    roleByEmployeeId,
    maxMonthlyWork,
    coverageEmergency = false,
  } = options;

  const empId = employee.id;
  const cargo = employee.role;
  const blockKey = assignmentKey(empId, workDay);

  if (cargo === "PAO") {
    if (["T1", "T2", "T3", "T4"].includes(shiftCode)) {
      return { ok: false, reason: `PAO não pode assumir turno de APAO (${shiftCode})` };
    }
    if (!["T6", "T7", "T8"].includes(shiftCode)) {
      return { ok: false, reason: `PAO só pode assumir T6, T7, T8 (proposto: ${shiftCode})` };
    }
  }

  if (cargo === "PAO FCF") {
    for (const key of planned.keys()) {
      const [oid, oday] = key.split("|");
      if (oday === workDay && Number(oid) !== empId && roleByEmployeeId.get(Number(oid)) === "PAO FCF") {
        return { ok: false, reason: "outro PAO FCF já escalado no dia" };
      }
    }
    for (const [key, bt] of blocked) {
      const [oid, oday] = key.split("|");
      if (oday === workDay && Number(oid) !== empId && roleByEmployeeId.get(Number(oid)) === "PAO FCF") {
        const t = bt.toUpperCase();
        if (["SIMULADOR", "CURSO ONLINE", "VOO"].includes(t)) {
          return { ok: false, reason: `outro PAO FCF ativo em ${bt}` };
        }
      }
    }
  }

  const blockType = blocked.get(blockKey);
  if (blockType) {
    const bt = normalizeOperationalLabel(blockType).toUpperCase();
    const folgaTypes = new Set([
      "FOLGA",
      "FOLGA ESCOLHIDA",
      "FOLGA SOCIAL",
      "FOLGA AGRUPADA",
      "FOLGA ANIVERSÁRIO",
      "FOLGA PEDIDA",
      "ND",
    ]);
    if (
      isProtectedPrealloc(bt) ||
      folgaTypes.has(bt) ||
      isOperationalHardBlock(blockType)
    ) {
      return { ok: false, reason: `bloqueado: ${blockType}` };
    }
    if (!(coverageEmergency || (cargo === "PAO FCF" && ["SIMULADOR", "CURSO ONLINE", "VOO"].includes(bt)))) {
      return { ok: false, reason: `bloqueado: ${blockType}` };
    }
  }

  if (shiftRestrictions && !coverageEmergency) {
    const restricted = shiftRestrictions.get(empId);
    if (restricted?.has(shiftCode.toUpperCase())) {
      return { ok: false, reason: `turno ${shiftCode} bloqueado no mês` };
    }
  }

  if (maxMonthlyWork != null && !coverageEmergency) {
    if (monthlyWorkCount(empId, planned) >= maxMonthlyWork) {
      return { ok: false, reason: `limite mensal de ${maxMonthlyWork} turnos` };
    }
  }

  if (planned.has(blockKey)) {
    return { ok: false, reason: "já alocado no dia" };
  }

  const info = shiftMap[shiftCode];
  if (info?.noWeekends && isWeekend(workDay)) {
    return { ok: false, reason: `turno ${shiftCode} não pode em fim de semana` };
  }

  const rest = has12hRest(empId, workDay, shiftCode, planned, shiftMap);
  if (!rest.ok && !coverageEmergency) {
    return { ok: false, reason: rest.reason };
  }

  if (maxSimultaneousWorkersIfAdded(empId, workDay, shiftCode, planned, shiftMap, roleByEmployeeId) > 2) {
    return { ok: false, reason: "limite físico de 2 estações simultâneas" };
  }

  const shiftRole = roleForShift(shiftCode, shiftMap);
  const isApaoShift = shiftRole === "APAO" || shiftRole === "BOTH";

  if (isApaoShift && cargo === "APAO") {
    if (!apaoHasNoOtherApaoOverlap(empId, workDay, shiftCode, planned, shiftMap)) {
      return { ok: false, reason: "dois APAOs simultâneos não permitido" };
    }

    const { start, end } = shiftStartEnd(workDay, info!.startTime, info!.endTime);
    const tempPlanned = new Map(planned);
    tempPlanned.set(blockKey, shiftCode);
    if (!intervalCoveredByPao(start, end, tempPlanned, shiftMap, roleByEmployeeId)) {
      return { ok: false, reason: "APAO sem PAO cobrindo o turno" };
    }
  }

  if (isApaoShift && cargo === "APAO") {
    if (consecutiveWorkCount(empId, workDay, planned) >= 6) {
      return { ok: false, reason: "APAO precisa folgar após 6 dias consecutivos" };
    }
  }

  if (cargo !== "PAO FCF" && !coverageEmergency) {
    if (consecutiveWorkCount(empId, workDay, planned) >= 6) {
      return { ok: false, reason: "mais de 6 dias consecutivos" };
    }
    if (shiftCode === "T8" && t8PreviousCount(empId, workDay, planned) >= 2) {
      return { ok: false, reason: "T8 após 2 dias consecutivos" };
    }
  }

  if (employee.isFixedShift && employee.fixedShiftCode && employee.fixedShiftCode !== shiftCode && !coverageEmergency) {
    return { ok: false, reason: `funcionário fixo no ${employee.fixedShiftCode}` };
  }

  return { ok: true, reason: "" };
}

export function canWorkInContext(
  ctx: ScheduleContext,
  employee: Employee,
  workDay: string,
  shiftCode: string,
  blocked: BlockedMap,
  planned?: PlannedMap,
  extra?: Partial<CanWorkOptions>,
): { ok: boolean; reason: string } {
  if (!isEmployeeInPlanning(ctx, employee.id, workDay)) {
    return { ok: false, reason: "de férias — fora do planejamento" };
  }

  const plan = planned ?? buildPlannedWithHistory(ctx);
  return canWork(employee, workDay, shiftCode, blocked, plan, {
    shiftMap: buildShiftMapFromContext(ctx),
    roleByEmployeeId: buildRoleMap(ctx),
    shiftRestrictions: ctx.shiftRestrictions,
    ...extra,
  });
}
