/** Filtra linhas de cadastro operacional pelo UUID do funcionário. */
export function filterCadastroRowsByEmployee<T>(
  rows: T[],
  employeeId: string,
  resolveEmployeeId: (row: T) => string,
): T[] {
  if (!employeeId) return rows;
  return rows.filter((row) => resolveEmployeeId(row) === employeeId);
}
