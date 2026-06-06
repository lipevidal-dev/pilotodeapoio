import { dateToIso, formatIsoDate } from './date-format';

describe('date-format — férias sem offset', () => {
  it('formatIsoDate mantém 02/06/2026 para ISO UTC midnight', () => {
    expect(formatIsoDate('2026-06-02T00:00:00.000Z')).toBe('02/06/2026');
  });

  it('formatIsoDate mantém 05/06/2026', () => {
    expect(formatIsoDate('2026-06-05')).toBe('05/06/2026');
  });

  it('dateToIso não desloca data local', () => {
    const d = new Date(2026, 5, 1);
    expect(dateToIso(d)).toBe('2026-06-01');
  });

  it('período 01/06–15/06', () => {
    expect(formatIsoDate('2026-06-01')).toBe('01/06/2026');
    expect(formatIsoDate('2026-06-15')).toBe('15/06/2026');
  });
});
