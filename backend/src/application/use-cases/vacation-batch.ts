export interface VacationPeriodInput {
  startDate: string;
  endDate: string;
}

export interface ExistingVacationKey {
  employeeId: string;
  startDateIso: string;
  endDateIso: string;
}

function periodKey(startDate: string, endDate: string): string {
  return `${startDate}|${endDate}`;
}

/** Separa períodos novos vs. duplicados exatos (mesmo funcionário + início + fim). */
export function splitVacationBatchPeriods(
  periods: VacationPeriodInput[],
  employeeId: string,
  existing: ExistingVacationKey[],
): { toCreate: VacationPeriodInput[]; skipped: VacationPeriodInput[] } {
  const seen = new Set<string>();
  const uniquePeriods: VacationPeriodInput[] = [];

  for (const p of periods) {
    const key = periodKey(p.startDate, p.endDate);
    if (!seen.has(key)) {
      seen.add(key);
      uniquePeriods.push(p);
    }
  }

  const existingSet = new Set(
    existing
      .filter((e) => e.employeeId === employeeId)
      .map((e) => periodKey(e.startDateIso, e.endDateIso)),
  );

  const toCreate: VacationPeriodInput[] = [];
  const skipped: VacationPeriodInput[] = [];

  for (const p of uniquePeriods) {
    const key = periodKey(p.startDate, p.endDate);
    if (existingSet.has(key)) {
      skipped.push(p);
    } else {
      toCreate.push(p);
    }
  }

  return { toCreate, skipped };
}
