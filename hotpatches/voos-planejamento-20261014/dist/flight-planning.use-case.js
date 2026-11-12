import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma-client.js";
import { formatFlightPlanningEmail, } from "../../domain/flight-planning/flight-planning-email.js";
import { buildFlightPlanningRoster, } from "../../domain/flight-planning/flight-planning-roster.js";
import { flightPlanningMonthLabel, isIsoDate, monthsTouched, monthOfIsoDate, periodWindowStatus, saoPauloDateKey, MAX_FLIGHT_PLANNING_MONTHS, } from "../../domain/flight-planning/flight-planning-period.js";
export const FLIGHT_PLANNING_CONFIG_KEY = "flight_planning_enabled";
const MAX_LINES = 40;
const MAX_DESCRIPTION = 400;
export class FlightPlanningClosedError extends Error {
    code = "FLIGHT_PLANNING_CLOSED";
    constructor() {
        super("Voos Planejamento não está habilitado.");
        this.name = "FlightPlanningClosedError";
    }
}
export class FlightPlanningNotLinkedError extends Error {
    code = "EMPLOYEE_NOT_LINKED";
    constructor() {
        super("Seu usuário não está vinculado a um colaborador.");
        this.name = "FlightPlanningNotLinkedError";
    }
}
export class FlightPlanningInvalidError extends Error {
    code = "FLIGHT_PLANNING_INVALID";
    constructor(message) {
        super(message);
        this.name = "FlightPlanningInvalidError";
    }
}
function mapRequestRow(row, lines) {
    return {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        createdAt: row.createdAt.toISOString(),
        lines,
    };
}
function periodView(row, today) {
    return {
        id: row.id,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        status: periodWindowStatus(today, row.startsOn, row.endsOn, row.closedAt != null),
    };
}
export class FlightPlanningUseCase {
    async isEnabled() {
        const period = await this.currentPeriod();
        return period?.status === "open";
    }
    async setEnabled(enabled, range) {
        if (!enabled) {
            await prisma.$executeRaw `UPDATE flight_planning_periods SET closed_at = NOW() WHERE closed_at IS NULL`;
            await this.syncFlag(false);
            return { enabled: false, period: null };
        }
        const startsOn = (range?.startsOn ?? "").trim();
        const endsOn = (range?.endsOn ?? "").trim();
        if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) {
            throw new FlightPlanningInvalidError("Informe o início e o fim do período.");
        }
        if (endsOn < startsOn) {
            throw new FlightPlanningInvalidError("A data final precisa ser igual ou posterior à data inicial.");
        }
        const months = monthsTouched(startsOn, endsOn);
        if (months.length > MAX_FLIGHT_PLANNING_MONTHS) {
            throw new FlightPlanningInvalidError(`O período pode ter no máximo ${MAX_FLIGHT_PLANNING_MONTHS} meses.`);
        }
        const periodId = randomUUID();
        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw `UPDATE flight_planning_periods SET closed_at = NOW() WHERE closed_at IS NULL`;
            await tx.$executeRaw `
        INSERT INTO flight_planning_periods (id, starts_on, ends_on)
        VALUES (${periodId}, CAST(${startsOn} AS date), CAST(${endsOn} AS date))
      `;
            for (const month of months) {
                await tx.$executeRaw `
          INSERT INTO flight_planning_packages (id, period_id, year, month)
          VALUES (${randomUUID()}, ${periodId}, ${month.year}, ${month.month})
        `;
            }
        });
        const period = await this.currentPeriod();
        const open = period?.status === "open";
        await this.syncFlag(open);
        return { enabled: open, period };
    }
    async listForAdmin(packageId) {
        const today = saoPauloDateKey(new Date());
        const [periods, packages, rows, lineRows, employees] = await Promise.all([
            prisma.$queryRaw `
        SELECT id,
               to_char(starts_on, 'YYYY-MM-DD') AS "startsOn",
               to_char(ends_on, 'YYYY-MM-DD') AS "endsOn",
               closed_at AS "closedAt"
        FROM flight_planning_periods
        ORDER BY created_at DESC
      `,
            prisma.$queryRaw `
        SELECT pkg.id,
               pkg.period_id AS "periodId",
               pkg.year,
               pkg.month,
               to_char(period.starts_on, 'YYYY-MM-DD') AS "startsOn",
               to_char(period.ends_on, 'YYYY-MM-DD') AS "endsOn",
               period.closed_at AS "closedAt"
        FROM flight_planning_packages pkg
        JOIN flight_planning_periods period ON period.id = pkg.period_id
        ORDER BY pkg.year DESC, pkg.month DESC, period.created_at DESC
      `,
            prisma.$queryRaw `
        SELECT req.id,
               req.employee_id AS "employeeId",
               emp.name AS "employeeName",
               req.created_at AS "createdAt",
               req.package_id AS "packageId"
        FROM flight_planning_requests req
        JOIN "Employee" emp ON emp.id = req.employee_id
        ORDER BY req.created_at ASC
      `,
            prisma.$queryRaw `
        SELECT request_id AS "requestId",
               to_char(date, 'YYYY-MM-DD') AS date,
               description
        FROM flight_planning_request_lines
        ORDER BY request_id ASC, sort_order ASC
      `,
            prisma.$queryRaw `
        SELECT id, name, active, type::text AS type, is_fcf AS "isFcf", is_cmte AS "isCmte"
        FROM "Employee"
      `,
        ]);
        const linesByRequest = new Map();
        for (const line of lineRows) {
            const list = linesByRequest.get(line.requestId) ?? [];
            list.push({ date: line.date, description: line.description });
            linesByRequest.set(line.requestId, list);
        }
        const counts = new Map();
        for (const row of rows) {
            if (!row.packageId)
                continue;
            counts.set(row.packageId, (counts.get(row.packageId) ?? 0) + 1);
        }
        const packageViews = packages.map((row) => ({
            id: row.id,
            year: row.year,
            month: row.month,
            label: flightPlanningMonthLabel(row.year, row.month),
            requestCount: counts.get(row.id) ?? 0,
        }));
        const active = periods.find((row) => row.closedAt == null) ?? null;
        const selected = this.pickPackage(packageId, packages, today);
        if (packageId && !selected) {
            throw new FlightPlanningInvalidError("Pacote não encontrado.");
        }
        const requests = rows
            .filter((row) => !selected || row.packageId === selected.id)
            .map((row) => mapRequestRow(row, linesByRequest.get(row.id) ?? []));
        const roster = buildFlightPlanningRoster(employees, requests.map((request) => request.employeeId));
        const requestedCount = roster.filter((row) => row.requested).length;
        const period = active ? periodView(active, today) : null;
        return {
            enabled: period?.status === "open",
            period,
            packages: packageViews,
            selectedPackageId: selected?.id ?? null,
            requests,
            emailText: formatFlightPlanningEmail(requests),
            roster,
            requestedCount,
            pendingCount: roster.length - requestedCount,
        };
    }
    async submit(userId, lines) {
        if (!(await this.isEnabled())) {
            throw new FlightPlanningClosedError();
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { employeeId: true },
        });
        if (!user?.employeeId) {
            throw new FlightPlanningNotLinkedError();
        }
        const normalized = normalizeLines(lines);
        const requestId = randomUUID();
        const createdAt = new Date();
        const empRows = await prisma.$queryRaw `
      SELECT id, name FROM "Employee" WHERE id = ${user.employeeId} LIMIT 1
    `;
        const employee = empRows[0];
        if (!employee) {
            throw new FlightPlanningNotLinkedError();
        }
        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw `
        INSERT INTO flight_planning_requests (id, employee_id, created_at)
        VALUES (${requestId}, ${employee.id}, ${createdAt})
      `;
            for (let index = 0; index < normalized.length; index++) {
                const line = normalized[index];
                await tx.$executeRaw `
          INSERT INTO flight_planning_request_lines (id, request_id, date, description, sort_order)
          VALUES (${randomUUID()}, ${requestId}, CAST(${line.date} AS date), ${line.description}, ${index})
        `;
            }
        });
        try {
            await this.attachToMonthPackage(requestId, createdAt);
        }
        catch (err) {
            await prisma.$executeRaw `DELETE FROM flight_planning_requests WHERE id = ${requestId}`;
            throw err;
        }
        return {
            employeeId: employee.id,
            employeeName: employee.name,
            createdAt: createdAt.toISOString(),
            lines: normalized,
        };
    }
    async currentPeriod() {
        const rows = await prisma.$queryRaw `
      SELECT id,
             to_char(starts_on, 'YYYY-MM-DD') AS "startsOn",
             to_char(ends_on, 'YYYY-MM-DD') AS "endsOn",
             closed_at AS "closedAt"
      FROM flight_planning_periods
      WHERE closed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
        const row = rows[0];
        if (!row)
            return null;
        return periodView(row, saoPauloDateKey(new Date()));
    }
    async syncFlag(enabled) {
        await prisma.systemConfig.upsert({
            where: { key: FLIGHT_PLANNING_CONFIG_KEY },
            create: { key: FLIGHT_PLANNING_CONFIG_KEY, value: enabled },
            update: { value: enabled },
        });
    }
    pickPackage(packageId, packages, today) {
        if (packageId)
            return packages.find((row) => row.id === packageId) ?? null;
        const todayMonth = monthOfIsoDate(today);
        const current = packages.find((row) => row.closedAt == null &&
            row.year === todayMonth.year &&
            row.month === todayMonth.month &&
            today >= row.startsOn &&
            today <= row.endsOn);
        return current ?? packages[0] ?? null;
    }
    async attachToMonthPackage(requestId, createdAt) {
        const today = saoPauloDateKey(createdAt);
        const month = monthOfIsoDate(today);
        const rows = await prisma.$queryRaw `
      SELECT pkg.id
      FROM flight_planning_packages pkg
      JOIN flight_planning_periods period ON period.id = pkg.period_id
      WHERE period.closed_at IS NULL
        AND pkg.year = ${month.year}
        AND pkg.month = ${month.month}
        AND CAST(${today} AS date) BETWEEN period.starts_on AND period.ends_on
      ORDER BY period.created_at DESC
      LIMIT 1
    `;
        const packageId = rows[0]?.id;
        if (!packageId) {
            throw new FlightPlanningClosedError();
        }
        await prisma.$executeRaw `
      UPDATE flight_planning_requests
      SET package_id = ${packageId},
          period_id = (SELECT period_id FROM flight_planning_packages WHERE id = ${packageId})
      WHERE id = ${requestId}
    `;
    }
}
function normalizeLines(lines) {
    if (!Array.isArray(lines) || lines.length < 1) {
        throw new FlightPlanningInvalidError("Inclua ao menos uma linha de solicitação.");
    }
    if (lines.length > MAX_LINES) {
        throw new FlightPlanningInvalidError(`Envie no máximo ${MAX_LINES} linhas por solicitação.`);
    }
    return lines.map((line, index) => {
        const date = (line?.date ?? "").trim();
        const description = (line?.description ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new FlightPlanningInvalidError(`Informe a data da linha ${index + 1}.`);
        }
        if (!description) {
            throw new FlightPlanningInvalidError(`Informe a solicitação do voo da linha ${index + 1}.`);
        }
        if (description.length > MAX_DESCRIPTION) {
            throw new FlightPlanningInvalidError(`A solicitação da linha ${index + 1} passa de ${MAX_DESCRIPTION} caracteres.`);
        }
        return { date, description };
    });
}
export const flightPlanningUseCase = new FlightPlanningUseCase();
//# sourceMappingURL=flight-planning.use-case.js.map