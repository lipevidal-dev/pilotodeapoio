import { dateToIso } from './date-format';
import type {
  PortalVacationCalendarDayEntry,
  PortalVacationCalendarPeriod,
} from '../models/api.models';

export function addIsoDays(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year!, month! - 1, day! + delta);
  return dateToIso(date);
}

export function expandVacationPeriodsToDays(
  periods: PortalVacationCalendarPeriod[],
): Record<string, PortalVacationCalendarDayEntry[]> {
  const days: Record<string, PortalVacationCalendarDayEntry[]> = {};

  for (const period of periods) {
    let day = period.startDate;
    while (day <= period.endDate) {
      (days[day] ??= []).push({
        vacationId: period.id,
        employeeId: period.employeeId,
        employeeName: period.employeeName,
        status: period.status,
        mine: period.mine,
      });
      day = addIsoDays(day, 1);
    }
  }

  for (const key of Object.keys(days)) {
    days[key]!.sort((a, b) => {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      if (a.status !== b.status) return a.status === 'APPROVED' ? -1 : 1;
      return a.employeeName.localeCompare(b.employeeName, 'pt-BR');
    });
  }

  return days;
}

export function isIsoInInclusiveRange(iso: string, start: string, end: string): boolean {
  if (!start) return false;
  const last = end || start;
  const lo = start <= last ? start : last;
  const hi = start <= last ? last : start;
  return iso >= lo && iso <= hi;
}

export function vacationStatusLabel(status: PortalVacationCalendarPeriod['status']): string {
  return status === 'APPROVED' ? 'Aprovado' : 'Pendente';
}
