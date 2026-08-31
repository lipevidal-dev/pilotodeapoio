import type { Prisma, ShiftSwapStatus } from "@prisma/client";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import { prisma } from "../database/prisma-client.js";

const swapInclude = {
  requester: { include: { role: true } },
  target: { include: { role: true } },
  scheduleMonth: true,
} satisfies Prisma.ShiftSwapRequestInclude;

export type ShiftSwapWithParties = Prisma.ShiftSwapRequestGetPayload<{
  include: typeof swapInclude;
}>;

export class ShiftSwapRepository {
  async create(data: {
    scheduleMonthId: string;
    kind?: "PEER" | "SELF";
    date: Date;
    targetDate?: Date | null;
    pairLength?: number;
    requesterDates?: string[];
    targetDates?: string[];
    requesterEmployeeId: string;
    targetEmployeeId: string;
    requesterShiftCode: string;
    targetShiftCode: string;
    notes?: string | null;
    status?: ShiftSwapStatus;
  }): Promise<ShiftSwapWithParties> {
    return prisma.shiftSwapRequest.create({
      data: {
        scheduleMonthId: data.scheduleMonthId,
        kind: data.kind ?? "PEER",
        date: data.date,
        targetDate: data.targetDate ?? null,
        pairLength: data.pairLength ?? 1,
        requesterDates: data.requesterDates ?? [],
        targetDates: data.targetDates ?? [],
        requesterEmployeeId: data.requesterEmployeeId,
        targetEmployeeId: data.targetEmployeeId,
        requesterShiftCode: data.requesterShiftCode,
        targetShiftCode: data.targetShiftCode,
        notes: data.notes ?? null,
        status: data.status ?? "OFFERED",
      },
      include: swapInclude,
    });
  }

  async findById(id: string): Promise<ShiftSwapWithParties | null> {
    return prisma.shiftSwapRequest.findUnique({
      where: { id },
      include: swapInclude,
    });
  }

  async listActiveForMonth(scheduleMonthId: string): Promise<ShiftSwapWithParties[]> {
    return prisma.shiftSwapRequest.findMany({
      where: {
        scheduleMonthId,
        status: "OFFERED",
      },
      include: swapInclude,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
  }

  async listApprovedForMonth(scheduleMonthId: string): Promise<ShiftSwapWithParties[]> {
    return prisma.shiftSwapRequest.findMany({
      where: {
        scheduleMonthId,
        status: "APPROVED",
      },
      include: swapInclude,
      orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async listForEmployee(employeeId: string, statuses?: ShiftSwapStatus[]): Promise<ShiftSwapWithParties[]> {
    return prisma.shiftSwapRequest.findMany({
      where: {
        OR: [{ requesterEmployeeId: employeeId }, { targetEmployeeId: employeeId }],
        ...(statuses?.length ? { status: { in: statuses } } : {}),
      },
      include: swapInclude,
      orderBy: [{ createdAt: "desc" }],
    });
  }

  async listAwaitingAdmin(): Promise<ShiftSwapWithParties[]> {
    return prisma.shiftSwapRequest.findMany({
      where: { status: "AWAITING_ADMIN" },
      include: swapInclude,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
  }

  async listApproved(limit = 200): Promise<ShiftSwapWithParties[]> {
    return prisma.shiftSwapRequest.findMany({
      where: { status: "APPROVED" },
      include: swapInclude,
      orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(1, limit), 500),
    });
  }

  async findActiveOverlap(params: {
    scheduleMonthId: string;
    dates: Date[];
    employeeIds: string[];
  }): Promise<ShiftSwapWithParties | null> {
    const isoDates = params.dates.map((d) => isoDateKey(d));
    const dateOr = params.dates.flatMap((d) => [{ date: d }, { targetDate: d }]);
    return prisma.shiftSwapRequest.findFirst({
      where: {
        scheduleMonthId: params.scheduleMonthId,
        status: { in: ["OFFERED", "AWAITING_ADMIN"] },
        OR: [
          { requesterEmployeeId: { in: params.employeeIds } },
          { targetEmployeeId: { in: params.employeeIds } },
        ],
        AND: [
          {
            OR: [
              ...dateOr,
              { requesterDates: { hasSome: isoDates } },
              { targetDates: { hasSome: isoDates } },
            ],
          },
        ],
      },
      include: swapInclude,
    });
  }

  async findApprovedDuplicate(params: {
    scheduleMonthId: string;
    requesterEmployeeId: string;
    targetEmployeeId: string;
    requesterDates: string[];
    targetDates: string[];
    requesterShiftCode: string;
    targetShiftCode: string;
  }): Promise<ShiftSwapWithParties | null> {
    return prisma.shiftSwapRequest.findFirst({
      where: {
        scheduleMonthId: params.scheduleMonthId,
        kind: "PEER",
        status: "APPROVED",
        requesterEmployeeId: params.requesterEmployeeId,
        targetEmployeeId: params.targetEmployeeId,
        requesterDates: { equals: params.requesterDates },
        targetDates: { equals: params.targetDates },
        requesterShiftCode: params.requesterShiftCode,
        targetShiftCode: params.targetShiftCode,
      },
      include: swapInclude,
      orderBy: { resolvedAt: "desc" },
    });
  }

  async updateStatus(
    id: string,
    status: ShiftSwapStatus,
    extra?: { respondedAt?: Date; resolvedAt?: Date },
  ): Promise<ShiftSwapWithParties> {
    return prisma.shiftSwapRequest.update({
      where: { id },
      data: {
        status,
        ...(extra?.respondedAt ? { respondedAt: extra.respondedAt } : {}),
        ...(extra?.resolvedAt ? { resolvedAt: extra.resolvedAt } : {}),
      },
      include: swapInclude,
    });
  }
}
