import {
  datesToContinuousPeriods,
  eachDayInRange,
  mergeDates,
  toggleDateInList,
} from './date-range-utils';

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day);
}

describe('date-range-utils', () => {
  it('datesToContinuousPeriods agrupa dias contínuos', () => {
    const input = [d(2026, 6, 1), d(2026, 6, 2), d(2026, 6, 3), d(2026, 6, 5), d(2026, 6, 6), d(2026, 6, 10)];
    expect(datesToContinuousPeriods(input)).toEqual([
      { startDate: '2026-06-01', endDate: '2026-06-03' },
      { startDate: '2026-06-05', endDate: '2026-06-06' },
      { startDate: '2026-06-10', endDate: '2026-06-10' },
    ]);
  });

  it('eachDayInRange inclui início e fim', () => {
    const days = eachDayInRange(d(2026, 6, 3), d(2026, 6, 5));
    expect(days.length).toBe(3);
  });

  it('mergeDates não duplica', () => {
    const merged = mergeDates([d(2026, 6, 1)], [d(2026, 6, 1), d(2026, 6, 2)]);
    expect(merged.length).toBe(2);
  });

  it('toggleDateInList remove data existente', () => {
    const toggled = toggleDateInList([d(2026, 6, 1), d(2026, 6, 2)], d(2026, 6, 1));
    expect(toggled.length).toBe(1);
  });
});
