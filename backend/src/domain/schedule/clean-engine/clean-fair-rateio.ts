/**
 * Rateio justo da demanda obrigatória PAO (T6/T7/T8…):
 * meta igual = floor(demanda / colaboradores).
 * Resto da divisão (parte quebrada) permanece como gap de cobertura —
 * não dá +1 para uns e deixa outros com menos.
 *
 * Extras de cobertura (+1/+2) usam o contador acumulado no ano civil
 * para escolher quem fica acima da meta no mês (compensado nos meses seguintes).
 */

import { iterDays } from "../../rules/dates.js";

/** Máximo de turnos acima da meta mensal justa na fase EXTRA_COBERTURA. */
export const MAX_MONTHLY_RATEIO_OVERSHOOT = 2;

export function calculateCoverageDemand(
  daysInMonth: number,
  coverageShiftCodes: string[],
): number {
  const codes = coverageShiftCodes.length > 0 ? coverageShiftCodes : ["T6", "T7", "T8"];
  return Math.max(0, daysInMonth) * codes.length;
}

/** Meta inteira idêntica por colaborador; sobra da divisão vira gap. */
export function fairRateioTargetPerEmployee(
  daysInMonth: number,
  coverageShiftCodes: string[],
  employeeCount: number,
): number {
  if (employeeCount <= 0) return 0;
  const demand = calculateCoverageDemand(daysInMonth, coverageShiftCodes);
  return Math.floor(demand / employeeCount);
}

export function fairRateioRemainderGaps(
  daysInMonth: number,
  coverageShiftCodes: string[],
  employeeCount: number,
): number {
  if (employeeCount <= 0) return calculateCoverageDemand(daysInMonth, coverageShiftCodes);
  const demand = calculateCoverageDemand(daysInMonth, coverageShiftCodes);
  return demand - fairRateioTargetPerEmployee(daysInMonth, coverageShiftCodes, employeeCount) * employeeCount;
}

/**
 * Meta justa acumulada de jan até `throughMonth` inclusive (ano civil).
 * Usada como "esperado" no saldo do contador.
 */
export function fairRateioExpectedYearToDate(
  year: number,
  throughMonth: number,
  coverageShiftCodes: string[],
  employeeCount: number,
): number {
  if (employeeCount <= 0 || throughMonth < 1) return 0;
  const last = Math.min(12, Math.max(1, Math.floor(throughMonth)));
  let sum = 0;
  for (let month = 1; month <= last; month++) {
    sum += fairRateioTargetPerEmployee(
      iterDays(year, month).length,
      coverageShiftCodes,
      employeeCount,
    );
  }
  return sum;
}

/**
 * Saldo do contador: acumulado − esperado YTD.
 * Mais negativo = mais prioritário para receber extras de cobertura.
 */
export function yearRateioSaldo(
  priorYearCount: number,
  currentMonthCount: number,
  expectedYearToDate: number,
): number {
  return priorYearCount + currentMonthCount - expectedYearToDate;
}
