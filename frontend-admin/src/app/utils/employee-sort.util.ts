import type { Employee } from '../models/api.models';

export function formatSeniorityLabel(employee: Pick<Employee, 'cargoCode' | 'type' | 'seniorityNumber'>): string {
  const code = (employee.cargoCode ?? employee.type ?? '').toUpperCase();
  const n = employee.seniorityNumber ?? Number.MAX_SAFE_INTEGER;
  return code === 'APAO' ? `${n}A` : String(n);
}

export function compareEmployeesBySeniority(a: Employee, b: Employee): number {
  const codeA = (a.cargoCode ?? a.type ?? '').toUpperCase();
  const codeB = (b.cargoCode ?? b.type ?? '').toUpperCase();
  const order = (code: string) => (code === 'PAO' ? 0 : code === 'APAO' ? 1 : 2);
  const byType = order(codeA) - order(codeB);
  if (byType !== 0) return byType;

  const sa = a.seniorityNumber ?? Number.MAX_SAFE_INTEGER;
  const sb = b.seniorityNumber ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;

  return a.name.localeCompare(b.name, 'pt-BR');
}

export function sortEmployeesBySeniority<T extends Employee>(rows: T[]): T[] {
  return [...rows].sort(compareEmployeesBySeniority);
}
