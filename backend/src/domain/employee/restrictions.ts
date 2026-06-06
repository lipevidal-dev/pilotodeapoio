export const MIN_SHIFTS_FULL_NO_FLIGHT_MONTH = 20;

export function dedupeIsoDates(dates: string[]): string[] {
  return [...new Set(dates.map((d) => d.trim()).filter(Boolean))];
}

export function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
