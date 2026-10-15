import { addDays, monthRange } from "./dates.js";
import { isoDateKey } from "./date-keys.js";

export function calendarQueryRange(year, month) {
    const { start, end } = monthRange(year, month);
    return { start: addDays(start, -6), end: addDays(end, 6) };
}

export function mapVacationRowsToCalendarPeriods(rows, viewerEmployeeId) {
    return rows
        .filter((row) => row.status === "PENDING" || row.status === "APPROVED")
        .map((row) => ({
            id: row.id,
            employeeId: row.employeeId,
            employeeName: row.employee?.name?.trim() || "Colaborador",
            startDate: isoDateKey(row.startDate),
            endDate: isoDateKey(row.endDate),
            status: row.status,
            mine: viewerEmployeeId != null && row.employeeId === viewerEmployeeId,
        }))
        .sort((a, b) => {
            const start = a.startDate.localeCompare(b.startDate);
            if (start !== 0)
                return start;
            if (a.mine !== b.mine)
                return a.mine ? -1 : 1;
            return a.employeeName.localeCompare(b.employeeName, "pt-BR");
        });
}

export function expandVacationPeriodsToDays(periods, fromIso, toIso) {
    const days = {};
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
        days[key].sort((a, b) => {
            if (a.mine !== b.mine)
                return a.mine ? -1 : 1;
            if (a.status !== b.status)
                return a.status === "APPROVED" ? -1 : 1;
            return a.employeeName.localeCompare(b.employeeName, "pt-BR");
        });
    }
    return days;
}
