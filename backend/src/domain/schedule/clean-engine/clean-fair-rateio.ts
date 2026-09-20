/**
 * Rateio justo da demanda obrigatória PAO (T6/T7/T8…):
 * meta igual = floor(demanda / colaboradores).
 * Resto da divisão (parte quebrada) permanece como gap de cobertura —
 * não dá +1 para uns e deixa outros com menos.
 */

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
