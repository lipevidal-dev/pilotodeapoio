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
  const mixedShifts = [
    shift({ code: 'T6', displayOrder: 1 }),
    shift({ code: 'T7', displayOrder: 2 }),
    shift({ code: 'T8', displayOrder: 3, requiresT8PairNd: true }),
    shift({
      code: 'T9',
      name: 'Turno 9 PAO',
      displayOrder: 4,
      coverageType: 'PARALLEL',
      startTime: '10:00',
      endTime: '18:00',
    }),
    shift({ code: 'T1', name: 'Turno 1 APAO', displayOrder: 0, roleType: 'APAO' }),
    shift({ code: 'T2', name: 'Turno 2 APAO', displayOrder: 1, roleType: 'APAO' }),
    shift({ code: 'T99', displayOrder: 99, active: false }),
  ];

  it('PAO: inclui turnos PAO/BOTH ativos e exclui APAO', () => {
    const options = buildManualAllocationOptions(mixedShifts, 'PAO');
    const keys = options.map((o) => o.key);

    expect(keys).toContain('T6');
    expect(keys).toContain('T7');
    expect(keys).toContain('T8');
    expect(keys).toContain('T8_BLOCK');
    expect(keys).toContain('T9');
    expect(keys.includes('T1' as ManualAllocationType)).toBe(false);
    expect(keys.includes('T2' as ManualAllocationType)).toBe(false);
    expect(keys.includes('T99' as ManualAllocationType)).toBe(false);

    const t9 = options.find((o) => o.key === 'T9');
    expect(t9?.label).toBe('Turno 9 PAO');
  });

  it('APAO: inclui turnos APAO/BOTH e exclui PAO', () => {
    const options = buildManualAllocationOptions(mixedShifts, 'APAO');
    const keys = options.map((o) => o.key);

    expect(keys).toContain('T1');
    expect(keys).toContain('T2');
    expect(keys.includes('T6' as ManualAllocationType)).toBe(false);
    expect(keys.includes('T7' as ManualAllocationType)).toBe(false);
    expect(keys.includes('T9' as ManualAllocationType)).toBe(false);
  });

  it('PAO: mantém cadastros operacionais completos e limpar período', () => {
    const options = buildManualAllocationOptions([shift({ code: 'T6' })], 'PAO');
    const keys = options.map((o) => o.key);

    expect(keys).toContain('FOLGA');
    expect(keys).toContain('FS');
    expect(keys).toContain('FP');
    expect(keys).toContain('VOO');
    expect(keys).toContain('CURSO');
    expect(keys).toContain('SIMULADOR');
    expect(keys).toContain('CMA');
    expect(keys).toContain('OUTRO');
    expect(keys).toContain('ND');
    expect(keys[keys.length - 1]).toBe('CLEAR');
  });

  it('APAO: cadastros operacionais reduzidos (sem VOO/CURSO/etc.)', () => {
    const options = buildManualAllocationOptions([shift({ code: 'T1', roleType: 'APAO' })], 'APAO');
    const keys = options.map((o) => o.key);

    expect(keys).toContain('FOLGA');
    expect(keys).toContain('FS');
    expect(keys).toContain('FP');
    expect(keys).toContain('ND');
    expect(keys.includes('VOO' as ManualAllocationType)).toBe(false);
    expect(keys.includes('CURSO' as ManualAllocationType)).toBe(false);
  });

  it('PAO fallback quando não há turnos ativos', () => {
    const options = buildManualAllocationOptions([], 'PAO');
    expect(options.some((o) => o.key === 'T9')).toBe(true);
  });

  it('APAO fallback quando não há turnos ativos', () => {
    const options = buildManualAllocationOptions([], 'APAO');
    expect(options.some((o) => o.key === 'T1')).toBe(true);
    expect(options.some((o) => o.key === 'T4')).toBe(true);
  });

  it('filtra por employeeTypeAllowed quando roleType não vem na API', () => {
    const legacyShifts = [
      {
        id: '1',
        code: 'T6',
        name: 'Turno 6 PAO',
        startTime: '06:00',
        endTime: '14:00',
        active: true,
        displayOrder: 1,
        mandatoryCoverage: true,
        requiresT8PairNd: false,
        coverageType: 'REQUIRED' as const,
        durationHours: 8,
        employeeTypeAllowed: 'PAO',
      },
      {
        id: '2',
        code: 'T1',
        name: 'Turno 1 APAO',
        startTime: '00:00',
        endTime: '06:00',
        active: true,
        displayOrder: 2,
        mandatoryCoverage: false,
        requiresT8PairNd: false,
        coverageType: 'REQUIRED' as const,
        durationHours: 6,
        employeeTypeAllowed: 'APAO',
      },
    ] as unknown as import('../models/api.models').Shift[];

    const apaoOptions = buildManualAllocationOptions(legacyShifts, 'APAO');
    const apaoKeys = apaoOptions.map((o) => o.key);
    expect(apaoKeys).toContain('T1');
    expect(apaoKeys.includes('T6' as ManualAllocationType)).toBe(false);
  });
});
