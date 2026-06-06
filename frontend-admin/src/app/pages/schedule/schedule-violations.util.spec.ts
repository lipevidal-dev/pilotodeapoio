import type { ScheduleViolation } from '../../models/api.models';

function filterVisibleViolations(
  list: ScheduleViolation[],
  level: 'CRITICAL' | 'WARNING',
): ScheduleViolation[] {
  const target = level;
  return list.filter((v) => {
    const u = (v.severity ?? '').toUpperCase();
    if (target === 'CRITICAL') {
      return u === 'CRITICAL' || u === 'CRÍTICA' || u === 'ALTA';
    }
    return u === 'WARNING' || u === 'MÉDIA' || u === 'MEDIA';
  });
}

describe('Painel de violações — sem INFO', () => {
  const mixed: ScheduleViolation[] = [
    { severity: 'CRITICAL', ruleCode: 'T8 ISOLADO', message: 'x', date: '2026-06-01', employee: 'A' },
    { severity: 'WARNING', ruleCode: 'MONOFOLGA', message: 'y', date: '2026-06-02', employee: 'B' },
    { severity: 'INFO', ruleCode: 'DISPONÍVEL PARA VOO', message: 'z', date: '2026-06-03', employee: 'C' },
  ];

  it('8. INFO não aparece nas listas visíveis', () => {
    const critical = filterVisibleViolations(mixed, 'CRITICAL');
    const warning = filterVisibleViolations(mixed, 'WARNING');
    expect(critical.length).toBe(1);
    expect(warning.length).toBe(1);
    expect([...critical, ...warning].some((v) => v.ruleCode === 'DISPONÍVEL PARA VOO')).toBe(false);
  });
});
