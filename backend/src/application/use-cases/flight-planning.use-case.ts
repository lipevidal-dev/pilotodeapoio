import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma-client.js";
import { isoDateKey, toDbDate } from "../../domain/rules/date-keys.js";
import {
  formatFlightPlanningEmail,
  type FlightPlanningEmailRequest,
} from "../../domain/flight-planning/flight-planning-email.js";
import {
  buildFlightPlanningRoster,
  type FlightPlanningRosterEmployee,
  type FlightPlanningRosterEntry,
} from "../../domain/flight-planning/flight-planning-roster.js";
import {
  flightPlanningMonthLabel,
  isIsoDate,
  monthsTouched,
  monthOfIsoDate,
  periodWindowStatus,
  saoPauloDateKey,
  MAX_FLIGHT_PLANNING_MONTHS,
} from "../../domain/flight-planning/flight-planning-period.js";

export const FLIGHT_PLANNING_CONFIG_KEY = "flight_planning_enabled";
const MAX_LINES = 40;
const MAX_DESCRIPTION = 400;

export class FlightPlanningClosedError extends Error {
  readonly code = "FLIGHT_PLANNING_CLOSED";

  constructor() {
    super("Voos Planejamento não está habilitado.");
    this.name = "FlightPlanningClosedError";
  }
}

export class FlightPlanningNotLinkedError extends Error {
  readonly code = "EMPLOYEE_NOT_LINKED";

  constructor() {
    super("Seu usuário não está vinculado a um colaborador.");
    this.name = "FlightPlanningNotLinkedError";
  }
}

export class FlightPlanningInvalidError extends Error {
  readonly code = "FLIGHT_PLANNING_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "FlightPlanningInvalidError";
  }
}

type LineInput = { date: string; description: string };

type PeriodRow = {
  id: string;
  startsOn: string;
  endsOn: string;
  closedAt: Date | null;
};

type PackageRow = {
  id: string;
  periodId: string;
  year: number;
  month: number;
  startsOn: string;
  endsOn: string;
  closedAt: Date | null;
};

export type FlightPlanningPeriodView = {
  id: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "scheduled" | "closed";
};

export type FlightPlanningPackageView = {
  id: string;
  year: number;
  month: number;
  label: string;
  requestCount: number;
};

const requestInclude = {
  employee: { select: { id: true, name: true } },
  lines: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.FlightPlanningRequestInclude;

function mapRequest(
  row: Prisma.FlightPlanningRequestGetPayload<{ include: typeof requestInclude }>,
): FlightPlanningEmailRequest {
  return {
    employeeId: row.employeeId,
    employeeName: row.employee.name,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      date: isoDateKey(line.date),
      description: line.description,
    })),
  };
}

function periodView(row: PeriodRow, today: string): FlightPlanningPeriodView {
  return {
    id: row.id,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: periodWindowStatus(today, row.startsOn, row.endsOn, row.closedAt != null),
  };
}

export class FlightPlanningUseCase {
  async isEnabled(): Promise<boolean> {
    const period = await this.currentPeriod();
    return period?.status === "open";
  }

  async setEnabled(
    enabled: boolean,
    range?: { startsOn?: string; endsOn?: string },
  ): Promise<{ enabled: boolean; period: FlightPlanningPeriodView | null }> {
    if (!enabled) {
      await prisma.$executeRaw`UPDATE flight_planning_periods SET closed_at = NOW() WHERE closed_at IS NULL`;
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
      await tx.$executeRaw`UPDATE flight_planning_periods SET closed_at = NOW() WHERE closed_at IS NULL`;
      await tx.$executeRaw`
        INSERT INTO flight_planning_periods (id, starts_on, ends_on)
        VALUES (${periodId}, CAST(${startsOn} AS date), CAST(${endsOn} AS date))
      `;
      for (const month of months) {
        await tx.$executeRaw`
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

  async listForAdmin(packageId?: string): Promise<{
    enabled: boolean;
    period: FlightPlanningPeriodView | null;
    packages: FlightPlanningPackageView[];
    selectedPackageId: string | null;
    requests: FlightPlanningEmailRequest[];
    emailText: string;
    roster: FlightPlanningRosterEntry[];
    requestedCount: number;
    pendingCount: number;
  }> {
    const today = saoPauloDateKey(new Date());
    const [periods, packages, rows, links, employees] = await Promise.all([
      prisma.$queryRaw<PeriodRow[]>`
        SELECT id,
               to_char(starts_on, 'YYYY-MM-DD') AS "startsOn",
               to_char(ends_on, 'YYYY-MM-DD') AS "endsOn",
               closed_at AS "closedAt"
        FROM flight_planning_periods
        ORDER BY created_at DESC
      `,
      prisma.$queryRaw<PackageRow[]>`
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
      prisma.flightPlanningRequest.findMany({
        include: requestInclude,
        orderBy: { createdAt: "asc" },
      }),
      prisma.$queryRaw<Array<{ id: string; packageId: string | null }>>`
        SELECT id, package_id AS "packageId"
        FROM flight_planning_requests
      `,
      prisma.$queryRaw<FlightPlanningRosterEmployee[]>`
        SELECT id, name, active, type::text AS type, is_fcf AS "isFcf", is_cmte AS "isCmte"
        FROM "Employee"
      `,
    ]);

    const packageByRequest = new Map(links.map((link) => [link.id, link.packageId]));
    const counts = new Map<string, number>();
    for (const link of links) {
      if (!link.packageId) continue;
      counts.set(link.packageId, (counts.get(link.packageId) ?? 0) + 1);
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
      .filter((row) => !selected || packageByRequest.get(row.id) === selected.id)
      .map(mapRequest);
    const roster = buildFlightPlanningRoster(
      employees,
      requests.map((request) => request.employeeId),
    );
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

  async submit(userId: string, lines: LineInput[]): Promise<FlightPlanningEmailRequest> {
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
    const created = await prisma.flightPlanningRequest.create({
      data: {
        employeeId: user.employeeId,
        lines: {
          create: normalized.map((line, index) => ({
            date: toDbDate(line.date),
            description: line.description,
            sortOrder: index,
          })),
        },
      },
      include: requestInclude,
    });
    try {
      await this.attachToMonthPackage(created.id, created.createdAt);
    } catch (err) {
      await prisma.flightPlanningRequest.delete({ where: { id: created.id } });
      throw err;
    }
    return mapRequest(created);
  }

  private async currentPeriod(): Promise<FlightPlanningPeriodView | null> {
    const rows = await prisma.$queryRaw<PeriodRow[]>`
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
    if (!row) return null;
    return periodView(row, saoPauloDateKey(new Date()));
  }

  private async syncFlag(enabled: boolean): Promise<void> {
    await prisma.systemConfig.upsert({
      where: { key: FLIGHT_PLANNING_CONFIG_KEY },
      create: { key: FLIGHT_PLANNING_CONFIG_KEY, value: enabled },
      update: { value: enabled },
    });
  }

  private pickPackage(packageId: string | undefined, packages: PackageRow[], today: string): PackageRow | null {
    if (packageId) return packages.find((row) => row.id === packageId) ?? null;
    const todayMonth = monthOfIsoDate(today);
    const current = packages.find(
      (row) =>
        row.closedAt == null &&
        row.year === todayMonth.year &&
        row.month === todayMonth.month &&
        today >= row.startsOn &&
        today <= row.endsOn,
    );
    return current ?? packages[0] ?? null;
  }

  private async attachToMonthPackage(requestId: string, createdAt: Date): Promise<void> {
    const today = saoPauloDateKey(createdAt);
    const month = monthOfIsoDate(today);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
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
    await prisma.$executeRaw`
      UPDATE flight_planning_requests
      SET package_id = ${packageId},
          period_id = (SELECT period_id FROM flight_planning_packages WHERE id = ${packageId})
      WHERE id = ${requestId}
    `;
  }
}

function normalizeLines(lines: LineInput[]): LineInput[] {
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
      throw new FlightPlanningInvalidError(
        `A solicitação da linha ${index + 1} passa de ${MAX_DESCRIPTION} caracteres.`,
      );
    }
    return { date, description };
  });
}

export const flightPlanningUseCase = new FlightPlanningUseCase();
