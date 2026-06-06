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

  create(data: { employeeId: string; startDate: string; endDate: string; notes?: string }) {
    return prisma.vacation.create({
      data: {
        employeeId: data.employeeId,
        startDate: toDbDate(data.startDate),
        endDate: toDbDate(data.endDate),
        notes: data.notes,
      },
      include: { employee: true },
    });
  }

  delete(id: string) {
    return prisma.vacation.delete({ where: { id } });
  }
}
