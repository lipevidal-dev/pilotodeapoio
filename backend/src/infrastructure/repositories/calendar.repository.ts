import { addDays, iterDays } from "../../domain/rules/dates.js";
import { isoDateKey, toDbDate } from "../../domain/rules/date-keys.js";
import { vacationDaysInMonth } from "../../domain/rules/vacation-dates.js";
import { prisma } from "../database/prisma-client.js";
export class CalendarRepository {
  async listVacationDaysForMonth(year: number, month: number) {
    const days = iterDays(year, month);
    const start = toDbDate(days[0]);
    const end = toDbDate(days[days.length - 1]);
    const rows = await prisma.vacation.findMany({
      where: {
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: { employee: true },
    });

    return vacationDaysInMonth(rows, year, month);
  }

  async listApprovedDayOffForMonth(year: number, month: number) {
    const days = iterDays(year, month);
    const start = toDbDate(days[0]);
    const end = toDbDate(days[days.length - 1]);
    const rows = await prisma.requestedDayOff.findMany({
      where: {
        status: "APPROVED",
        date: { gte: start, lte: end },
      },
    });

    return rows.map((r) => ({
      employeeUuid: r.employeeId,
      date: isoDateKey(r.date),
    }));
  }

  /** Folga de retorno no 1º dia do mês quando férias terminaram no mês anterior. */
  async listVacationReturnDaysForMonth(year: number, month: number) {
    const firstDay = iterDays(year, month)[0];
    const prevLast = addDays(firstDay, -1);

    const rows = await prisma.vacation.findMany({
      where: { endDate: toDbDate(prevLast) },
    });

    return rows.map((r) => ({
      employeeUuid: r.employeeId,
      date: firstDay,
    }));
  }

  async listFlightDaysForMonth(year: number, month: number) {    const days = iterDays(year, month);
    const start = toDbDate(days[0]);
    const end = toDbDate(days[days.length - 1]);
    const rows = await prisma.flightAssignment.findMany({
      where: { date: { gte: start, lte: end } },
    });

    return rows.map((r) => ({
      id: r.id,
      employeeUuid: r.employeeId,
      date: isoDateKey(r.date),
      description: r.description ?? undefined,
      source: r.source,
    }));
  }
}
export const calendarRepository = new CalendarRepository();
