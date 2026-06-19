import type { Shift } from "@prisma/client";
import type {
  PreferredShiftRow,
  ShiftRestrictionRow,
} from "../generation-types.js";
import {
  parseFcfScheduleJson,
  type EmployeeFcfRule,
  type WeekdayIndex,
} from "../../employee/fcf-config.js";
import type { EmployeeMotorPrefStored } from "./next-motor-stored-config.js";

function sanitizeWeekday(raw: unknown): number | null {
  if (raw === null) return null;
  if (!Number.isInteger(raw)) return null;
  const wd = raw as number;
  if (wd < 0 || wd > 6) return null;
  return wd;
}

export function sanitizeEmployeeMotorPrefs(
  raw: unknown,
): Record<string, EmployeeMotorPrefStored> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: Record<string, EmployeeMotorPrefStored> = {};
  for (const [employeeId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof employeeId !== "string" || !employeeId) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const obj = value as Record<string, unknown>;
    const restrictedRaw = obj.restrictedShiftIds;
    const restrictedShiftIds = Array.isArray(restrictedRaw)
      ? [...new Set(restrictedRaw.filter((id): id is string => typeof id === "string" && id.length > 0))]
      : [];

    let preferredShiftId: string | null = null;
    if (obj.preferredShiftId === null) {
      preferredShiftId = null;
    } else if (typeof obj.preferredShiftId === "string" && obj.preferredShiftId.length > 0) {
      preferredShiftId = obj.preferredShiftId;
    }

    let fcfPriorityShiftId: string | null = null;
    if (obj.fcfPriorityShiftId === null) {
      fcfPriorityShiftId = null;
    } else if (typeof obj.fcfPriorityShiftId === "string" && obj.fcfPriorityShiftId.length > 0) {
      fcfPriorityShiftId = obj.fcfPriorityShiftId;
    }

    const fcfWeekday = sanitizeWeekday(obj.fcfWeekday);

    out[employeeId] = { preferredShiftId, restrictedShiftIds, fcfPriorityShiftId, fcfWeekday };
  }
  return out;
}

function shiftCodeById(shifts: Shift[], shiftId: string): string | null {
  const row = shifts.find((s) => s.id === shiftId);
  return row ? row.code.toUpperCase() : null;
}

function defaultT9ShiftId(shifts: Shift[]): string | null {
  const t9 = shifts.find((s) => s.code.toUpperCase() === "T9" && s.active);
  return t9?.id ?? null;
}

function rowsFromMotorPref(
  employeeUuid: string,
  pref: EmployeeMotorPrefStored,
  shifts: Shift[],
): {
  preferred: PreferredShiftRow[];
  restricted: ShiftRestrictionRow[];
} {
  const preferred: PreferredShiftRow[] = [];
  const restricted: ShiftRestrictionRow[] = [];

  if (pref.preferredShiftId) {
    const code = shiftCodeById(shifts, pref.preferredShiftId);
    if (code) preferred.push({ employeeUuid, shiftCode: code });
  }

  for (const shiftId of pref.restrictedShiftIds ?? []) {
    const code = shiftCodeById(shifts, shiftId);
    if (code) restricted.push({ employeeUuid, shiftCode: code });
  }

  return { preferred, restricted };
}

/** Preferências do motor sobrescrevem cadastro do funcionário quando configuradas. */
export function applyMotorEmployeeShiftPrefs(params: {
  preferredShiftRows: PreferredShiftRow[];
  shiftRestrictionRows: ShiftRestrictionRow[];
  employeePrefs?: Record<string, EmployeeMotorPrefStored>;
  shifts: Shift[];
}): {
  preferredShiftRows: PreferredShiftRow[];
  shiftRestrictionRows: ShiftRestrictionRow[];
} {
  const motorPrefs = params.employeePrefs;
  if (!motorPrefs || Object.keys(motorPrefs).length === 0) {
    return {
      preferredShiftRows: params.preferredShiftRows,
      shiftRestrictionRows: params.shiftRestrictionRows,
    };
  }

  const overridden = new Set(Object.keys(motorPrefs));
  const preferredShiftRows = params.preferredShiftRows.filter(
    (r) => !overridden.has(r.employeeUuid),
  );
  const shiftRestrictionRows = params.shiftRestrictionRows.filter(
    (r) => !overridden.has(r.employeeUuid),
  );

  for (const [employeeUuid, pref] of Object.entries(motorPrefs)) {
    const rows = rowsFromMotorPref(employeeUuid, pref, params.shifts);
    preferredShiftRows.push(...rows.preferred);
    shiftRestrictionRows.push(...rows.restricted);
  }

  return { preferredShiftRows, shiftRestrictionRows };
}

type FcfEmployeeRow = { id: string; isFcf: boolean; fcfSchedule: unknown };

/** Regras FCF a partir do motor (sobrescreve fcfSchedule do cadastro quando fcfWeekday configurado). */
export function buildFcfRulesFromMotorPrefs(params: {
  employees: FcfEmployeeRow[];
  employeePrefs?: Record<string, EmployeeMotorPrefStored>;
  shifts: Shift[];
}): EmployeeFcfRule[] {
  const shiftById = new Map(params.shifts.map((s) => [s.id, s.code.toUpperCase()]));
  const defaultT9Id = defaultT9ShiftId(params.shifts);
  const rules: EmployeeFcfRule[] = [];
  const motorPrefs = params.employeePrefs ?? {};

  for (const e of params.employees) {
    if (!e.isFcf) continue;

    const pref = motorPrefs[e.id];
    if (pref?.fcfWeekday != null) {
      const shiftId = pref.fcfPriorityShiftId ?? defaultT9Id;
      const code = shiftId ? shiftById.get(shiftId) : null;
      if (code) {
        rules.push({
          employeeUuid: e.id,
          shiftCode: code,
          weekday: pref.fcfWeekday as WeekdayIndex,
        });
      }
      continue;
    }

    for (const entry of parseFcfScheduleJson(e.fcfSchedule)) {
      const code = shiftById.get(entry.shiftId);
      if (!code) continue;
      rules.push({ employeeUuid: e.id, shiftCode: code, weekday: entry.weekday });
    }
  }

  return rules;
}
