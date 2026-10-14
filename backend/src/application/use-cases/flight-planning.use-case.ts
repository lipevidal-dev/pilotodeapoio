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

export class FlightPlanningUseCase {
  async isEnabled(): Promise<boolean> {
    const row = await prisma.systemConfig.findUnique({
      where: { key: FLIGHT_PLANNING_CONFIG_KEY },
    });
    return row?.value === true;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    await prisma.systemConfig.upsert({
      where: { key: FLIGHT_PLANNING_CONFIG_KEY },
      create: { key: FLIGHT_PLANNING_CONFIG_KEY, value: enabled },
      update: { value: enabled },
    });
    return enabled;
  }

  async listForAdmin(): Promise<{
    enabled: boolean;
    requests: FlightPlanningEmailRequest[];
    emailText: string;
    roster: FlightPlanningRosterEntry[];
    requestedCount: number;
    pendingCount: number;
  }> {
    const [enabled, rows, employees] = await Promise.all([
      this.isEnabled(),
      prisma.flightPlanningRequest.findMany({
        include: requestInclude,
        orderBy: { createdAt: "asc" },
      }),
      prisma.$queryRaw<FlightPlanningRosterEmployee[]>`
        SELECT id, name, active, type::text AS type, is_fcf AS "isFcf", is_cmte AS "isCmte"
        FROM "Employee"
      `,
    ]);
    const requests = rows.map(mapRequest);
    const roster = buildFlightPlanningRoster(employees, requests.map((request) => request.employeeId));
    const requestedCount = roster.filter((row) => row.requested).length;
    return {
      enabled,
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
    return mapRequest(created);
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
