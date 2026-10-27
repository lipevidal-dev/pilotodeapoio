export const EMPLOYEE_OBSERVATION_MAX = 500;

export function normalizeEmployeeObservation(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return text.length > EMPLOYEE_OBSERVATION_MAX ? text.slice(0, EMPLOYEE_OBSERVATION_MAX) : text;
}
