import { buildEmployeeOccupancyMap } from './employee-occupancy.util';

describe('buildEmployeeOccupancyMap — fonte operationalCadastros', () => {
  const employeeId = 'emp-1';

  const baseSchedule = {
    scheduleMonth: { id: 'sm1', year: 2026, month: 6, status: 'DRAFT' as const },
    employees: [],
    shifts: [],
    assignments: [] as never[],
    preAllocations: [],
  };

  it('marca férias e FP com siglas compactas', () => {
    const map = buildEmployeeOccupancyMap({
      employeeId,
      year: 2026,
      month: 6,
      schedule: {
        ...baseSchedule,
        operationalCadastros: [
          {
            id: 'v1',
            employeeId,
            date: '2026-06-10T12:00:00.000Z',
            label: 'FÉRIAS',
            source: 'vacation',
          },
          {
            id: 'fp1',
            employeeId,
            date: '2026-06-15T12:00:00.000Z',
            label: 'FOLGA PEDIDA',
            source: 'requested_day_off',
          },
        ],
      },
    });

    expect(map['2026-06-10']?.display).toBe('FÉRIAS');
    expect(map['2026-06-10']?.kind).toBe('ferias');
    expect(map['2026-06-10']?.blocked).toBe(true);
    expect(map['2026-06-10']?.title).toContain('Férias');
    expect(map['2026-06-15']?.display).toBe('FP');
    expect(map['2026-06-16']).toBeUndefined();
  });

  it('VOO manual no calendário usa mesma origem da escala', () => {
    const map = buildEmployeeOccupancyMap({
      employeeId,
      year: 2026,
      month: 6,
      schedule: {
        ...baseSchedule,
        operationalCadastros: [
          {
            id: 'f1',
            employeeId,
            date: '2026-06-05T12:00:00.000Z',
            label: 'VOO',
            source: 'flight',
            notes: 'GRU-SDU',
          },
        ],
      },
    });

    expect(map['2026-06-05']?.display).toBe('VOO');
    expect(map['2026-06-05']?.kind).toBe('voo');
    expect(map['2026-06-05']?.title).toContain('Voo manual');
  });

  it('VOO tem prioridade sobre turno gerado (igual à escala)', () => {
    const map = buildEmployeeOccupancyMap({
      employeeId,
      year: 2026,
      month: 6,
      schedule: {
        ...baseSchedule,
        assignments: [
          {
            id: 'a1',
            scheduleMonthId: 'sm1',
            employeeId,
            date: '2026-06-05T12:00:00.000Z',
            shiftCode: 'T6',
            label: null,
            source: 'generated',
          },
        ],
        operationalCadastros: [
          {
            id: 'f1',
            employeeId,
            date: '2026-06-05T12:00:00.000Z',
            label: 'VOO',
            source: 'flight',
          },
        ],
      },
    });

    expect(map['2026-06-05']?.display).toBe('VOO');
    expect(map['2026-06-05']?.kind).toBe('voo');
  });

  it('não exibe VOO fantasma de preAllocation legada', () => {
    const map = buildEmployeeOccupancyMap({
      employeeId,
      year: 2026,
      month: 6,
      schedule: {
        ...baseSchedule,
        preAllocations: [
          {
            id: 'p1',
            employeeId,
            date: '2026-06-08T12:00:00.000Z',
            label: 'VOO',
          },
        ],
        operationalCadastros: [],
      },
    });

    expect(map['2026-06-08']).toBeUndefined();
  });

  it('exibe SIM para simulador com sigla compacta', () => {
    const map = buildEmployeeOccupancyMap({
      employeeId,
      year: 2026,
      month: 6,
      schedule: {
        ...baseSchedule,
        operationalCadastros: [
          {
            id: 's1',
            employeeId,
            date: '2026-06-09T12:00:00.000Z',
            label: 'SIMULADOR',
            source: 'pre_allocation',
          },
        ],
      },
    });

    expect(map['2026-06-09']?.display).toBe('SIM');
    expect(map['2026-06-09']?.kind).toBe('simulador');
  });
});
