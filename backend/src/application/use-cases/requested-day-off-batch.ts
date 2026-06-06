export interface ExistingDayOffKey {
  employeeId: string;
  dateIso: string;
  status: string;
}

/** Separa datas novas vs. duplicadas (mesmo funcionário + data + status). */
export function splitBatchDates(
  dates: string[],
  employeeId: string,
  status: string,
  existing: ExistingDayOffKey[],
): { toCreate: string[]; skipped: string[] } {
  const uniqueDates = [...new Set(dates)].sort();
  const existingSet = new Set(
    existing
      .filter((e) => e.employeeId === employeeId && e.status === status)
      .map((e) => e.dateIso),
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
