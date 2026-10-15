import {
  addIsoDays,
  expandVacationPeriodsToDays,
  isIsoInInclusiveRange,
  vacationStatusLabel,
} from './vacation-calendar.util';
import type { PortalVacationCalendarPeriod } from '../models/api.models';

describe('vacation-calendar.util', () => {
  const periods: PortalVacationCalendarPeriod[] = [
    {
      id: 'v-me',
      employeeId: 'e-1',
      employeeName: 'Ana',
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      status: 'PENDING',
      mine: true,
    },
    {
      id: 'v-other',
      employeeId: 'e-2',
      employeeName: 'Bruno',
      startDate: '2026-10-11',
      endDate: '2026-10-12',
      status: 'APPROVED',
      mine: false,
    },
  ];

  it('expande os espelhos por dia com o próprio colaborador primeiro', () => {
    const days = expandVacationPeriodsToDays(periods);
    expect(days['2026-10-11']?.map((e) => e.employeeName)).toEqual(['Bruno']);
    expect(days['2026-10-12']?.map((e) => e.employeeName)).toEqual(['Ana', 'Bruno']);
  });

  it('avança datas ISO sem deslocar o mês', () => {
    expect(addIsoDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('marca o intervalo escolhido no formulário', () => {
    expect(isIsoInInclusiveRange('2026-10-15', '2026-10-10', '2026-10-20')).toBeTrue();
    expect(isIsoInInclusiveRange('2026-10-09', '2026-10-10', '2026-10-20')).toBeFalse();
    expect(isIsoInInclusiveRange('2026-10-10', '2026-10-12', '')).toBeFalse();
  });

  it('traduz o status do pedido', () => {
    expect(vacationStatusLabel('APPROVED')).toBe('Aprovado');
    expect(vacationStatusLabel('PENDING')).toBe('Pendente');
  });
});
