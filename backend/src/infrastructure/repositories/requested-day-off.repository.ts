import type { RequestedDayOffStatus } from "@prisma/client";
import { prisma } from "../database/prisma-client.js";

function toDbDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export class RequestedDayOffRepository {
  findAll() {
    return prisma.requestedDayOff.findMany({
      include: { employee: true },
      orderBy: [{ date: "desc" }, { employee: { name: "asc" } }],
    });
  }

  findById(id: string) {
    return prisma.requestedDayOff.findUnique({
      where: { id },
      include: { employee: true },
    });
  }

  findByEmployeeDatesStatus(
    employeeId: string,
    dates: string[],
    status: RequestedDayOffStatus,
  ) {
    if (dates.length === 0) return Promise.resolve([]);
    return prisma.requestedDayOff.findMany({
      where: {
        employeeId,
        status,
        date: { in: dates.map(toDbDate) },
      },
      include: { employee: true },
    });
  }

  create(data: {
    employeeId: string;
    date: string;
    status?: RequestedDayOffStatus;
    notes?: string;
  }) {
    return prisma.requestedDayOff.create({
      data: {
        employeeId: data.employeeId,
        date: toDbDate(data.date),
        status: data.status ?? "PENDING",
        notes: data.notes,
      },
      include: { employee: true },
    });
  }

  delete(id: string) {
    return prisma.requestedDayOff.delete({ where: { id } });
  }
}
