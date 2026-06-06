export interface GridCellCoordinate {
  employeeId: string;
  day: number;
}

export function selectionKey(cell: GridCellCoordinate): string {
  return `${cell.employeeId}|${cell.day}`;
}

/** Seleção horizontal na mesma linha; ignora mudança de funcionário. */
export function buildHorizontalSelection(
  anchor: GridCellCoordinate,
  current: GridCellCoordinate,
): GridCellCoordinate[] {
  if (anchor.employeeId !== current.employeeId) {
    return [anchor];
  }
  const min = Math.min(anchor.day, current.day);
  const max = Math.max(anchor.day, current.day);
  const out: GridCellCoordinate[] = [];
  for (let day = min; day <= max; day++) {
    out.push({ employeeId: anchor.employeeId, day });
  }
  return out;
}

export function isoDateFromGrid(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
