import type { ScheduleGridData } from '../models/schedule-grid.models';
import { filterGridByPdfScope, schedulePdfScopeLabel } from './schedule-pdf-scope.util';

function grid(): ScheduleGridData {
  return {
    year: 2026,
    month: 11,
    daysInMonth: 1,
    dayNumbers: [1],
    weekdayLabels: ['Dom'],
    columns: [],
    leadDayCount: 0,
    groups: [
      {
        type: 'PAO',
        label: 'PAO',
        rows: [{ employeeId: 'pao-1', name: 'Alexandre', type: 'PAO', isFcf: false, cells: [], summary: {} as never }],
      },
      {
        type: 'CMTE',
        label: 'CMTE / FCF',
        rows: [
          { employeeId: 'cmte-1', name: 'Dreher', type: 'PAO', isCmte: true, isFcf: true, cells: [], summary: {} as never },
          { employeeId: 'fcf-1', name: 'Luccas', type: 'PAO', isFcf: true, cells: [], summary: {} as never },
          { employeeId: 'cmte-2', name: 'So Cmte', type: 'PAO', isCmte: true, isFcf: false, cells: [], summary: {} as never },
        ],
      },
      {
        type: 'APAO',
        label: 'APAO',
        rows: [{ employeeId: 'apao-1', name: 'Apao', type: 'APAO', cells: [], summary: {} as never }],
      },
    ],
  };
}

describe('filterGridByPdfScope', () => {
  it('PAO + CMTE/FCF deixa de fora o APAO', () => {
    const filtered = filterGridByPdfScope(grid(), 'pao-cmte');
    expect(filtered.groups.map((g) => g.type)).toEqual(['PAO', 'CMTE']);
    expect(filtered.groups[1].rows.map((r) => r.name)).toEqual(['Dreher', 'Luccas', 'So Cmte']);
    expect(schedulePdfScopeLabel('pao-cmte')).toBe('PAO + CMTE/FCF');
  });

  it('escala FCF traz só quem tem cargo FCF', () => {
    const filtered = filterGridByPdfScope(grid(), 'fcf');
    expect(filtered.groups.map((g) => g.label)).toEqual(['FCF']);
    expect(filtered.groups[0].rows.map((r) => r.name)).toEqual(['Dreher', 'Luccas']);
    expect(schedulePdfScopeLabel('fcf')).toBe('FCF');
  });
});
