import {
  computePaoDayBudget,
  countEmployeePreCommittedDays,
  toPaoDayBudgetCompact,
} from './pao-day-budget.util';
import type { Employee, ScheduleMonthResponse } from '../models/api.models';

function pao(partial: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    name: 'Palombino',
    type: 'PAO',
    roleId: 'r1',
    cargoCode: 'PAO',
    cargoName: 'PAO',
    active: true,
    ...partial,
  };
}

const baseInput = {
  year: 2026,
  month: 7,
  enabled: {
    pao_meta_turnos: true,
    pao_10_folgas: true,
    pao_1_folga_social: true,
  },
  params: {
    pao_shift_meta_turnos__T6: 20,
    pao_shift_meta_folgas__T6: 10,
    pao_shift_meta_folga_social__T6: 1,
    pao_shift_meta_turnos__T8: 20,
    pao_shift_meta_folgas__T8: 10,
    pao_shift_meta_folga_social__T8: 1,
  },
  rateioShiftCodes: ['T6', 'T8'],
};

describe('pao-day-budget.util', () => {
  it('conta pré-alocações e FP sem duplicar o mesmo dia', () => {
    const schedule: ScheduleMonthResponse = {
      scheduleMonth: { id: 'sm1', year: 2026, month: 7, status: 'DRAFT' },
      employees: [],
      shifts: [],
      assignments: [],
      preAllocations: [
        { id: 'p1', employeeId: 'emp-1', date: '2026-07-05T00:00:00.000Z', label: 'CURSO' },
      ],
      operationalCadastros: [
        {
          id: 'o1',
          employeeId: 'emp-1',
          date: '2026-07-10T00:00:00.000Z',
          label: 'FP',
          source: 'requested_day_off',
        },
        {
          id: 'o2',
          employeeId: 'emp-1',
          date: '2026-07-05T00:00:00.000Z',
          label: 'CURSO',
          source: 'pre_allocation',
        },
      ],
    };

    const pre = countEmployeePreCommittedDays('emp-1', 2026, 7, schedule);
    expect(pre.total).toBe(2);
    expect(pre.preAllocations).toBe(1);
    expect(pre.requestedOff).toBe(1);
  });

  it('calcula saldo do mês com metas e dias já fixos', () => {
    const schedule: ScheduleMonthResponse = {
      scheduleMonth: { id: 'sm1', year: 2026, month: 7, status: 'DRAFT' },
      employees: [],
      shifts: [],
      assignments: [],
      preAllocations: [
        { id: 'p1', employeeId: 'emp-1', date: '2026-07-05T00:00:00.000Z', label: 'FP' },
      ],
      operationalCadastros: [],
    };

    const budget = computePaoDayBudget(pao(), baseInput, schedule, 'T6');
    expect(budget).not.toBeNull();
    expect(budget!.totalDays).toBe(31);
    expect(budget!.preCommitted.total).toBe(1);
    expect(budget!.metaPlanned.total).toBe(31);
    expect(budget!.remaining).toBe(-1);
    expect(budget!.overBudget).toBeTrue();
  });

  it('compacto expõe percentuais da barra', () => {
    const schedule: ScheduleMonthResponse = {
      scheduleMonth: { id: 'sm1', year: 2026, month: 7, status: 'DRAFT' },
      employees: [],
      shifts: [],
      assignments: [],
      preAllocations: [
        { id: 'p1', employeeId: 'emp-1', date: '2026-07-05T00:00:00.000Z', label: 'FP' },
      ],
      operationalCadastros: [],
    };
    const budget = computePaoDayBudget(pao(), baseInput, schedule, 'T6');
    const compact = toPaoDayBudgetCompact(budget!);
    expect(compact.totalDays).toBe(31);
    expect(compact.remaining).toBe(-1);
    expect(compact.fixedPct + compact.metaPct + compact.freePct).toBeCloseTo(100, 0);
  });

  it('retorna null para APAO', () => {
    const emp = pao({ type: 'APAO', cargoCode: 'APAO', cargoName: 'APAO' });
    expect(computePaoDayBudget(emp, baseInput, null)).toBeNull();
  });
});
