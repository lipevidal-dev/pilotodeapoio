import { buildScheduleGrid } from './schedule-cell.mapper';
import type { Employee } from '../models/api.models';

describe('schedule-cell.mapper — Dias Trabalhados display', () => {
  const emp: Employee = {
    id: 'pao-1',
    name: 'Luccas',
    type: 'PAO',
    roleId: 'role-pao',
    cargoCode: 'PAO',
    cargoName: 'PAO',
    active: true,
  };

  it('9 turnos + 2 ND = 11 Dias Trabalhados', () => {
    const assignments = Array.from({ length: 9 }, (_, i) => ({
      id: `a-${i}`,
      scheduleMonthId: 'm1',
      employeeId: 'pao-1',
      date: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      shiftCode: 'T7',
      label: null,
      source: 'GENERATED',
      employee: emp,
    }));
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments,
      preAllocations: [
        { id: 'nd-1', employeeId: 'pao-1', date: '2026-06-10T00:00:00.000Z', label: 'ND' },
        { id: 'nd-2', employeeId: 'pao-1', date: '2026-06-11T00:00:00.000Z', label: 'ND' },
      ],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.turnos).toBe(9);
    expect(summary.nd).toBe(2);
    expect(summary.diasTrabalhados).toBe(11);
  });

  it('SIM conta em Dias Trabalhados mas não em Turnos', () => {
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: 'a1',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-01T00:00:00.000Z',
          shiftCode: 'T8',
          label: null,
          source: 'GENERATED',
          employee: emp,
        },
      ],
      preAllocations: [
        { id: 'sim-1', employeeId: 'pao-1', date: '2026-06-02T00:00:00.000Z', label: 'SIMULADOR' },
      ],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.turnos).toBe(1);
    expect(summary.simuladores).toBe(1);
    expect(summary.diasTrabalhados).toBe(2);
  });

  it('FP não conta em Dias Trabalhados', () => {
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: 'a1',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-01T00:00:00.000Z',
          shiftCode: 'T6',
          label: null,
          source: 'GENERATED',
          employee: emp,
        },
      ],
      preAllocations: [],
      operationalCadastros: [
        {
          id: 'fp-1',
          employeeId: 'pao-1',
          date: '2026-06-05T00:00:00.000Z',
          label: 'FOLGA PEDIDA',
          source: 'requested_day_off',
        },
      ],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.fp).toBe(1);
    expect(summary.diasTrabalhados).toBe(1);
  });
});
