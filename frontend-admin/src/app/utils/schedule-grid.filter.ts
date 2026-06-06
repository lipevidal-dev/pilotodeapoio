import type { EmployeeType } from '../models/api.models';
import type { ScheduleGridData } from '../models/schedule-grid.models';

export interface GridFilterOptions {
  type: 'ALL' | EmployeeType;
  employeeId: string | null;
  singleEmployeeOnly: boolean;
}

export function applyGridFilters(
  grid: ScheduleGridData,
  options: GridFilterOptions,
): ScheduleGridData {
  let groups = grid.groups.map((g) => ({
    ...g,
    rows: [...g.rows],
  }));

  if (options.type !== 'ALL') {
    groups = groups.filter((g) => g.type === options.type);
  }

  if (options.employeeId) {
    groups = groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => r.employeeId === options.employeeId),
      }))
      .filter((g) => g.rows.length > 0);
  } else if (options.singleEmployeeOnly) {
    groups = [];
  }

  return { ...grid, groups };
}
