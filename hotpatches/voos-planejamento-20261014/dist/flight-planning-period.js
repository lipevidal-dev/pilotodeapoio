const MONTHS_PT = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
];
export const MAX_FLIGHT_PLANNING_MONTHS = 24;
export function isIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export function saoPauloDateKey(date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}
export function monthOfIsoDate(iso) {
    const [year, month] = iso.slice(0, 10).split("-").map(Number);
    return { year, month };
}
/** Meses civis tocados pelo período, inclusive o mês inicial e o final. */
export function monthsTouched(startsOn, endsOn) {
    const start = monthOfIsoDate(startsOn);
    const end = monthOfIsoDate(endsOn);
    const months = [];
    let year = start.year;
    let month = start.month;
    while (year < end.year || (year === end.year && month <= end.month)) {
        months.push({ year, month });
        month += 1;
        if (month === 13) {
            month = 1;
            year += 1;
        }
        if (months.length > MAX_FLIGHT_PLANNING_MONTHS)
            break;
    }
    return months;
}
export function flightPlanningMonthLabel(year, month) {
    const name = MONTHS_PT[month - 1] ?? String(month);
    return `${name}/${year}`;
}
export function periodWindowStatus(today, startsOn, endsOn, closed) {
    if (closed || today > endsOn)
        return "closed";
    if (today < startsOn)
        return "scheduled";
    return "open";
}
//# sourceMappingURL=flight-planning-period.js.map