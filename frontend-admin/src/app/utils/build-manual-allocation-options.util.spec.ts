import { buildManualAllocationOptions } from './build-manual-allocation-options.util';
import type { ManualAllocationType, Shift } from '../models/api.models';

function shift(partial: Partial<Shift> & Pick<Shift, 'code'>): Shift {
  return {
    id: partial.id ?? '1',
    name: partial.name ?? partial.code,
    startTime: partial.startTime ?? '06:00',
    endTime: partial.endTime ?? '14:00',
    roleType: partial.roleType ?? 'PAO',
    active: partial.active ?? true,
    displayOrder: partial.displayOrder ?? 0,
    mandatoryCoverage: partial.mandatoryCoverage ?? true,
    requiresT8PairNd: partial.requiresT8PairNd ?? false,
    coverageType: partial.coverageType ?? 'REQUIRED',
    durationHours: partial.durationHours ?? 8,
    ...partial,
  };
}

describe('buildManualAllocationOptions', () => {
  it('inclui turnos PAO/BOTH ativos e T9 paralelo', () => {
    const options = buildManualAllocationOptions([
      shift({ code: 'T6', displayOrder: 1 }),
      shift({ code: 'T7', displayOrder: 2 }),
      shift({ code: 'T8', displayOrder: 3, requiresT8PairNd: true }),
      shift({ code: 'T9', displayOrder: 4, coverageType: 'PARALLEL', startTime: '10:00', endTime: '18:00' }),
      shift({ code: 'T1', displayOrder: 0, roleType: 'APAO', active: true }),
      shift({ code: 'T99', displayOrder: 99, active: false }),
    ]);

    const keys = options.map((o) => o.key);
    expect(keys).toContain('T6');
    expect(keys).toContain('T7');
    expect(keys).toContain('T8');
    expect(keys).toContain('T8_BLOCK');
    expect(keys).toContain('T9');
    expect(keys.includes('T1' as ManualAllocationType)).toBe(false);
    expect(keys.includes('T99' as ManualAllocationType)).toBe(false);

    const t9 = options.find((o) => o.key === 'T9');
    expect(t9?.label).toBe('T9 (paralelo)');
  });

  it('mantém cadastros operacionais e limpar período', () => {
    const options = buildManualAllocationOptions([shift({ code: 'T6' })]);
    const keys = options.map((o) => o.key);

    expect(keys).toContain('FOLGA');
    expect(keys).toContain('FP');
    expect(keys).toContain('VOO');
    expect(keys).toContain('CURSO');
    expect(keys).toContain('SIMULADOR');
    expect(keys).toContain('CMA');
    expect(keys).toContain('OUTRO');
    expect(keys).toContain('ND');
    expect(keys[keys.length - 1]).toBe('CLEAR');
  });

  it('usa fallback quando não há turnos ativos', () => {
    const options = buildManualAllocationOptions([]);
    expect(options.some((o) => o.key === 'T9')).toBe(true);
  });
});
