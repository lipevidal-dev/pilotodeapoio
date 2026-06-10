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

export interface DayRange {
  startDay: number;
  endDay: number;
}

/** Agrupa dias selecionados (Ctrl+clique) em intervalos contíguos para edição manual. */
export function groupContiguousDays(days: number[]): DayRange[] {
  if (days.length === 0) return [];
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const ranges: DayRange[] = [];
  let start = sorted[0]!;
  let end = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const day = sorted[i]!;
    if (day === end + 1) {
      end = day;
      continue;
    }
    ranges.push({ startDay: start, endDay: end });
    start = day;
    end = day;
  }
  ranges.push({ startDay: start, endDay: end });
  return ranges;
}
