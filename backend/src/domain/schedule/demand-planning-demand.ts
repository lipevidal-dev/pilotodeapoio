import type { OperationalDemand } from "./demand-planning-types.js";
import { PAO_SHIFTS_PER_DAY } from "./demand-planning-types.js";

/** Etapa 1 — Demanda = dias × turnos PAO (T6+T7+T8). */
export function calculateOperationalDemand(daysInMonth: number): OperationalDemand {
  const perDay = PAO_SHIFTS_PER_DAY;
  return {
    daysInMonth,
    shiftsPerDay: perDay,
    totalDemand: daysInMonth * perDay,
    perShift: {
      T6: daysInMonth,
      T7: daysInMonth,
      T8: daysInMonth,
    },
  };
}
