import type { ScheduleGridData } from '../models/schedule-grid.models';

export type SchedulePdfScope = 'all' | 'mine' | 'pao' | 'pao-cmte' | 'fcf' | 'apao';

export const SCHEDULE_PDF_SCOPE_OPTIONS: Array<{
  value: SchedulePdfScope;
  label: string;
  description: string;
}> = [
  {
    value: 'all',
    label: 'Exportar todo mundo',
    description: 'Inclui PAO, CMTE / FCF e APAO na escala.',
  },
  {
    value: 'mine',
    label: 'Exportar apenas meu usuário',
    description: 'Somente a sua linha na escala.',
  },
  {
    value: 'pao',
    label: 'Exportar PAOs',
    description: 'Somente o grupo PAO.',
  },
  {
    value: 'pao-cmte',
    label: 'Exportar PAO + CMTE/FCF',
    description: 'Grupos PAO e CMTE / FCF, sem APAO.',
  },
  {
    value: 'fcf',
    label: 'Exportar escala FCF',
    description: 'Somente colaboradores com cargo FCF.',
  },
  {
    value: 'apao',
    label: 'Exportar APAOs',
    description: 'Somente o grupo APAO.',
  },
];

export function schedulePdfScopeLabel(scope: SchedulePdfScope): string {
  switch (scope) {
    case 'mine':
      return 'Meu usuário';
    case 'pao':
      return 'PAOs';
    case 'pao-cmte':
      return 'PAO + CMTE/FCF';
    case 'fcf':
      return 'FCF';
    case 'apao':
      return 'APAOs';
    default:
      return 'Completa';
  }
}

export function filterGridByPdfScope(
  grid: ScheduleGridData,
  scope: SchedulePdfScope,
  employeeId?: string | null,
): ScheduleGridData {
  if (scope === 'all') return grid;

  if (scope === 'pao') {
    return {
      ...grid,
      groups: grid.groups.filter((g) => g.type === 'PAO'),
    };
  }

  if (scope === 'pao-cmte') {
    return {
      ...grid,
      groups: grid.groups.filter((g) => g.type === 'PAO' || g.type === 'CMTE'),
    };
  }

  if (scope === 'fcf') {
    return {
      ...grid,
      groups: grid.groups
        .map((g) => ({
          ...g,
          label: g.type === 'CMTE' ? 'FCF' : g.label,
          rows: g.rows.filter((r) => r.isFcf),
        }))
        .filter((g) => g.rows.length > 0),
    };
  }

  if (scope === 'apao') {
    return {
      ...grid,
      groups: grid.groups.filter((g) => g.type === 'APAO'),
    };
  }

  // mine
  if (!employeeId) {
    return { ...grid, groups: [] };
  }

  return {
    ...grid,
    groups: grid.groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => r.employeeId === employeeId),
      }))
      .filter((g) => g.rows.length > 0),
  };
}
