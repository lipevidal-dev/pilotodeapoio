export interface ExistingFlightKey {
  employeeId: string;
  dateIso: string;
}

/** Separa datas novas vs. duplicadas (mesmo funcionário + data). */
export function splitFlightBatchDates(
  dates: string[],
  employeeId: string,
  existing: ExistingFlightKey[],
): { toCreate: string[]; skipped: string[] } {
  const uniqueDates = [...new Set(dates)].sort();
  const existingSet = new Set(
    existing.filter((e) => e.employeeId === employeeId).map((e) => e.dateIso),
  );

  const toCreate: string[] = [];
  const skipped: string[] = [];

  for (const d of uniqueDates) {
    if (existingSet.has(d)) {
      skipped.push(d);
    } else {
      toCreate.push(d);
    }
  }

  return { toCreate, skipped };
}
