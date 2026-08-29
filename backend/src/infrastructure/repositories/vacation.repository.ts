import type { VacationStatus } from "@prisma/client";
import { toDbDate } from "../../domain/rules/date-keys.js";
import { prisma } from "../database/prisma-client.js";

export class VacationRepository {
  findAll() {
    return prisma.vacation.findMany({
      include: { employee: true },
      orderBy: [{ startDate: "desc" }, { employee: { name: "asc" } }],
    });
  }

  findById(id: string) {
    return prisma.vacation.findUnique({
      where: { id },
      include: { employee: true },
    });
  }

  findByEmployee(employeeId: string) {
    return prisma.vacation.findMany({
      where: { employeeId },
      include: { employee: true },
    });
  }

  findOverlapping(
    employeeId: string,
    startDate: string,
    endDate: string,
    statuses: VacationStatus[] = ["PENDING", "APPROVED"],
  ) {
    return prisma.vacation.findMany({
      where: {
        employeeId,
        status: { in: statuses },
        startDate: { lte: toDbDate(endDate) },
        endDate: { gte: toDbDate(startDate) },
      },
      include: { employee: true },
    });
  }

  create(data: {
    employeeId: string;
    startDate: string;
    endDate: string;
    notes?: string;
    status?: VacationStatus;
    thirteenthAdvanceRequested?: boolean;
    sellTenDaysRequested?: boolean;
  }) {
    return prisma.vacation.create({
      data: {
        employeeId: data.employeeId,
        startDate: toDbDate(data.startDate),
        endDate: toDbDate(data.endDate),
        notes: data.notes,
        status: data.status ?? "APPROVED",
        thirteenthAdvanceRequested: data.thirteenthAdvanceRequested ?? false,
        thirteenthAdvanceStatus: data.thirteenthAdvanceRequested ? "PENDING" : null,
        sellTenDaysRequested: data.sellTenDaysRequested ?? false,
        sellTenDaysStatus: data.sellTenDaysRequested ? "PENDING" : null,
      },
      include: { employee: true },
    });
  }

  delete(id: string) {
    return prisma.vacation.delete({ where: { id } });
  }

  update(
    id: string,
    data: {
      employeeId?: string;
      startDate?: string;
      endDate?: string;
      notes?: string | null;
      status?: VacationStatus;
    },
  ) {
    return prisma.vacation.update({
      where: { id },
      data: {
        employeeId: data.employeeId,
        startDate: data.startDate ? toDbDate(data.startDate) : undefined,
        endDate: data.endDate ? toDbDate(data.endDate) : undefined,
        notes: data.notes,
        status: data.status,
      },
      include: { employee: true },
    });
  }
}
