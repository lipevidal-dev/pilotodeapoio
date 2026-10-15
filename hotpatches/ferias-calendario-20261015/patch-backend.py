#!/usr/bin/env python3
from pathlib import Path
import sys

work = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ferias-cal-patch")

repo = work / "vacation.repository.js"
use_case = work / "vacation.use-case.js"
routes = work / "routes.index.js"

repo_text = repo.read_text(encoding="utf-8")
method = """
    findVisibleOverlapping(startDate, endDate, statuses = ["PENDING", "APPROVED"]) {
        return prisma.vacation.findMany({
            where: {
                status: { in: statuses },
                startDate: { lte: toDbDate(endDate) },
                endDate: { gte: toDbDate(startDate) },
            },
            include: { employee: { select: { id: true, name: true } } },
            orderBy: [{ startDate: "asc" }, { employee: { name: "asc" } }],
        });
    }
"""
if "findVisibleOverlapping" not in repo_text:
    needle = "    }\n    create(data) {"
    if needle not in repo_text:
        raise SystemExit("vacation.repository.js: ponto de inserção não encontrado")
    repo_text = repo_text.replace(needle, "    }" + method + "    create(data) {", 1)
    repo.write_text(repo_text, encoding="utf-8")

uc = use_case.read_text(encoding="utf-8")
imp = 'import { calendarQueryRange, expandVacationPeriodsToDays, mapVacationRowsToCalendarPeriods } from "../../domain/rules/vacation-calendar.js";\n'
if "vacation-calendar.js" not in uc:
    uc = uc.replace(
        'import { isoDateKey } from "../../domain/rules/date-keys.js";\n',
        'import { isoDateKey } from "../../domain/rules/date-keys.js";\n' + imp,
        1,
    )
method_uc = """
    async portalCalendar(year, month, viewerEmployeeId) {
        const range = calendarQueryRange(year, month);
        const rows = await this.repo.findVisibleOverlapping(range.start, range.end);
        const periods = mapVacationRowsToCalendarPeriods(rows, viewerEmployeeId);
        return {
            year,
            month,
            periods,
            days: expandVacationPeriodsToDays(periods, range.start, range.end),
        };
    }
"""
if "portalCalendar" not in uc:
    needle = "    async remove(id) {"
    if needle not in uc:
        raise SystemExit("vacation.use-case.js: ponto de inserção não encontrado")
    uc = uc.replace(needle, method_uc + "    async remove(id) {", 1)
    use_case.write_text(uc, encoding="utf-8")

rt = routes.read_text(encoding="utf-8")
imp_rt = 'import { getPortalVacationCalendarController } from "../controllers/portal-vacation-calendar.controller.js";\n'
if "getPortalVacationCalendarController" not in rt:
    rt = rt.replace(
        'from "../controllers/vacation.controller.js";\n',
        'from "../controllers/vacation.controller.js";\n' + imp_rt,
        1,
    )
    if 'app.get("/portal/vacations/calendar"' not in rt:
        rt = rt.replace(
            '    app.get("/portal/profile", getPortalProfileController);\n',
            '    app.get("/portal/profile", getPortalProfileController);\n    app.get("/portal/vacations/calendar", getPortalVacationCalendarController);\n',
            1,
        )
    routes.write_text(rt, encoding="utf-8")

print("backend dist patched")
