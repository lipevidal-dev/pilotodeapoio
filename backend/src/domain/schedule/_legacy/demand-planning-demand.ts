import type { Shift } from "../../shift/types.js";
import type { OperationalDemand } from "./demand-planning-types.js";
import { listPaoPrimaryShiftCodes } from "./pao-rateio-shifts.js";

/** Demanda mensal para rateio/fairness — apenas cobertura REQUIRED PAO (T6/T7/T8). T9 não entra. */
export function calculateTurnRateioDemand(
  daysInMonth: number,
  shifts: Shift[] = [],
): OperationalDemand {
  return calculateRequiredCoverageDemand(daysInMonth, shifts);
}

/** @deprecated Prefer calculateTurnRateioDemand — mantido para relatórios legados. */
export function calculateOperationalDemand(
  daysInMonth: number,
  shifts: Shift[] = [],
): OperationalDemand {
  return calculateTurnRateioDemand(daysInMonth, shifts);
}

/** Demanda de cobertura obrigatória PAO (T6/T7/T8 ou futuros REQUIRED) — exclui PARALLEL e APAO. */
export function calculateRequiredCoverageDemand(
  daysInMonth: number,
  shifts: Shift[] = [],
): OperationalDemand {
  const required = listPaoPrimaryShiftCodes(shifts);
  const codes = required.length > 0 ? required : ["T6", "T7", "T8"];
  const perShift: Record<string, number> = {};
  for (const code of codes) perShift[code] = daysInMonth;
  return {
    daysInMonth,
    shiftsPerDay: codes.length,
    totalDemand: daysInMonth * codes.length,
    perShift,
  };
}
