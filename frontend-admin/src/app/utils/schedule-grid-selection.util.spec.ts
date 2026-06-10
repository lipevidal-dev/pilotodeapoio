import {
  buildHorizontalSelection,
  groupContiguousDays,
  isoDateFromGrid,
  selectionKey,
} from './schedule-grid-selection.util';

describe('schedule-grid-selection.util', () => {
  it('1. seleciona intervalo horizontal na mesma linha', () => {
    const cells = buildHorizontalSelection(
      { employeeId: 'emp-1', day: 15 },
      { employeeId: 'emp-1', day: 17 },
    );
    expect(cells.map((c) => c.day)).toEqual([15, 16, 17]);
  });

  it('2. ignora mudança de funcionário durante drag', () => {
    const cells = buildHorizontalSelection(
      { employeeId: 'emp-1', day: 10 },
      { employeeId: 'emp-2', day: 12 },
    );
    expect(cells).toEqual([{ employeeId: 'emp-1', day: 10 }]);
  });

  it('3. gera chave e data ISO', () => {
    expect(selectionKey({ employeeId: 'a', day: 5 })).toBe('a|5');
    expect(isoDateFromGrid(2026, 7, 3)).toBe('2026-07-03');
  });

  it('4. agrupa dias Ctrl+clique em intervalos contíguos', () => {
    expect(groupContiguousDays([3, 4, 5, 10, 11])).toEqual([
      { startDay: 3, endDay: 5 },
      { startDay: 10, endDay: 11 },
    ]);
  });
});
