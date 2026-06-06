/** Extrai yyyy-mm-dd de Date (UTC) ou string ISO — sem shift de timezone. */
export function isoDateKey(value: string | Date): string {
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return isoDateKey(new Date(value));
  }
  const y = value.getUTCFullYear();
  const mo = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Persistência segura de data civil em PostgreSQL Date. */
export function toDbDate(iso: string): Date {
  return new Date(`${isoDateKey(iso)}T12:00:00.000Z`);
}
