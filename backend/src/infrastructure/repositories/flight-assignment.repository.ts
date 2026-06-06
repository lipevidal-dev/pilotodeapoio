import type { AssignmentSource } from "@prisma/client";
import { prisma } from "../database/prisma-client.js";

function toDbDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export class FlightAssignmentRepository {
  findAll() {
    return prisma.flightAssignment.findMany({
      include: { employee: true },
      orderBy: [{ date: "desc" }, { employee: { name: "asc" } }],
    });
  }

  findById(id: string) {
    return prisma.flightAssignment.findUnique({
      where: { id },
      include: { employee: true },
    });
  }

  findByEmployeeDates(employeeId: string, dates: string[]) {
    if (dates.length === 0) return Promise.resolve([]);
    return prisma.flightAssignment.findMany({
      where: {
        employeeId,
        date: { in: dates.map(toDbDate) },
      },
      include: { employee: true },
    });
  }

  create(data: {
    employeeId: string;
    date: string;
    description?: string;
    source?: AssignmentSource;
  }) {
    return prisma.flightAssignment.create({
      data: {
        employeeId: data.employeeId,
        date: toDbDate(data.date),
        description: data.description,
        source: data.source ?? "MANUAL",
      },
      include: { employee: true },
    });
  }

  delete(id: string) {
    return prisma.flightAssignment.delete({ where: { id } });
  }
}
