/** Férias concentradas na 1ª ou 2ª quinzena (~15 dias). */

export type VacationFortnight = "FIRST_HALF" | "SECOND_HALF";

/** Detecta férias quinzenais a partir dos dias bloqueados como FÉRIAS no mês. */
export function detectVacationFortnight(
  monthDays: readonly string[],
  vacationDates: readonly string[],
): VacationFortnight | null {
  if (vacationDates.length < 10) return null;

  const vacSet = new Set(vacationDates);
  const mid = Math.floor(monthDays.length / 2);
  const firstHalf = monthDays.slice(0, mid);
  const secondHalf = monthDays.slice(mid);

  const inFirst = firstHalf.filter((d) => vacSet.has(d)).length;
  const inSecond = secondHalf.filter((d) => vacSet.has(d)).length;

  if (inFirst >= 10 && inSecond <= 2) return "FIRST_HALF";
  if (inSecond >= 10 && inFirst <= 2) return "SECOND_HALF";
  return null;
}

export function vacationDatesForEmployee(
  vacationDays: ReadonlyArray<{ employeeUuid: string; date: string }>,
  uuid: string,
): string[] {
  return vacationDays.filter((v) => v.employeeUuid === uuid).map((v) => v.date);
}
