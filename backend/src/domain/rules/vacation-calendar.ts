import { addDays, monthRange } from "./dates.js";
import { isoDateKey } from "./date-keys.js";

export type VacationCalendarStatus = "PENDING" | "APPROVED";

export interface VacationCalendarPeriod {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  status: VacationCalendarStatus;
  mine: boolean;
}

export interface VacationCalendarDayEntry {
  vacationId: string;
  employeeId: string;
  employeeName: string;
  status: VacationCalendarStatus;
  mine: boolean;
}

/** Intervalo com folga para a grade de 6 semanas do calendário mensal. */
export function calendarQueryRange(year: number, month: number): { start: string; end: string } {
  const { start, end } = monthRange(year, month);
  return { start: addDays(start, -6), end: addDays(end, 6) };
}

export function mapVacationRowsToCalendarPeriods(
  rows: Array<{
    id: string;
    employeeId: string;
    startDate: string | Date;
    endDate: string | Date;
    status: string;
    employee?: { name: string } | null;
  }>,
  viewerEmployeeId: string | null,
): VacationCalendarPeriod[] {
  return rows
    .filter((row) => row.status === "PENDING" || row.status === "APPROVED")
    .map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      employeeName: row.employee?.name?.trim() || "Colaborador",
      startDate: isoDateKey(row.startDate),
      endDate: isoDateKey(row.endDate),
      status: row.status as VacationCalendarStatus,
      mine: viewerEmployeeId != null && row.employeeId === viewerEmployeeId,
    }))
    .sort((a, b) => {
      const start = a.startDate.localeCompare(b.startDate);
      if (start !== 0) return start;
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      return a.employeeName.localeCompare(b.employeeName, "pt-BR");
    });
}

export function expandVacationPeriodsToDays(
  periods: VacationCalendarPeriod[],
  fromIso: string,
  toIso: string,
): Record<string, VacationCalendarDayEntry[]> {
  const days: Record<string, VacationCalendarDayEntry[]> = {};

  for (const period of periods) {
    let day = period.startDate < fromIso ? fromIso : period.startDate;
    const last = period.endDate > toIso ? toIso : period.endDate;
    while (day <= last) {
      (days[day] ??= []).push({
        vacationId: period.id,
        employeeId: period.employeeId,
        employeeName: period.employeeName,
        status: period.status,
        mine: period.mine,
      });
      day = addDays(day, 1);
    }
  }

  for (const key of Object.keys(days)) {
    days[key]!.sort((a, b) => {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      if (a.status !== b.status) return a.status === "APPROVED" ? -1 : 1;
      return a.employeeName.localeCompare(b.employeeName, "pt-BR");
    });
  }

  return days;
}
