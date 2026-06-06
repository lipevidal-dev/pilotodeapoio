import type { Shift } from "./types.js";

/** Turnos padrão da migração v3 (v1). */
export const DEFAULT_SHIFTS: Shift[] = [
  { code: "T8", role: "PAO", name: "Turno 8 PAO", startTime: "22:00", endTime: "06:00", minStaff: 1, maxStaff: 1 },
  { code: "T6", role: "PAO", name: "Turno 6 PAO", startTime: "06:00", endTime: "14:00", minStaff: 1, maxStaff: 1 },
  { code: "T7", role: "PAO", name: "Turno 7 PAO", startTime: "14:00", endTime: "22:00", minStaff: 1, maxStaff: 1 },
  { code: "T1", role: "APAO", name: "Turno 1 APAO", startTime: "00:00", endTime: "06:00", minStaff: 1, maxStaff: 1 },
  { code: "T2", role: "APAO", name: "Turno 2 APAO", startTime: "06:00", endTime: "12:00", minStaff: 1, maxStaff: 1 },
  { code: "T3", role: "APAO", name: "Turno 3 APAO", startTime: "12:00", endTime: "18:00", minStaff: 1, maxStaff: 1 },
  { code: "T4", role: "APAO", name: "Turno 4 APAO", startTime: "18:00", endTime: "00:00", minStaff: 1, maxStaff: 1 },
];

export const PAO_SHIFT_CODES = new Set(["T6", "T7", "T8"]);
export const APAO_SHIFT_CODES = new Set(["T1", "T2", "T3", "T4"]);

export function buildShiftMap(shifts: Shift[] = DEFAULT_SHIFTS): import("./types.js").ShiftMap {
  const map: import("./types.js").ShiftMap = {};
  for (const s of shifts) {
    map[s.code] = {
      startTime: s.startTime,
      endTime: s.endTime,
      role: s.role,
      noWeekends: Boolean(s.noWeekends),
    };
  }
  return map;
}
