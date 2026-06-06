import { prisma } from "../database/prisma-client.js";

function toDbDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export class PreAllocationRepository {
  async findAll(filters?: {
    scheduleMonthId?: string;
    year?: number;
    month?: number;
    label?: string;
  }) {
    const where: {
      scheduleMonthId?: string;
      scheduleMonth?: { year: number; month: number };
      label?: string;
    } = {};
    if (filters?.scheduleMonthId) {
      where.scheduleMonthId = filters.scheduleMonthId;
    } else if (filters?.year !== undefined && filters?.month !== undefined) {
      where.scheduleMonth = { year: filters.year, month: filters.month };
    }
    if (filters?.label) {
      where.label = filters.label;
    }
    return prisma.preAllocation.findMany({
      where: Object.keys(where).length ? where : undefined,
      include: { employee: true, scheduleMonth: true },
      orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
    });
  }

  async findById(id: string) {
    return prisma.preAllocation.findUnique({
      where: { id },
      include: { employee: true },
    });
  }

  findByScheduleMonthEmployeeDates(
    scheduleMonthId: string,
    employeeId: string,
    dates: string[],
  ) {
    if (dates.length === 0) return Promise.resolve([]);
    return prisma.preAllocation.findMany({
      where: {
        scheduleMonthId,
        employeeId,
        date: { in: dates.map(toDbDate) },
      },
      include: { employee: true },
    });
  }

  async create(data: {
    scheduleMonthId: string;
    employeeId: string;
    date: Date;
    label: string;
    notes?: string;
  }) {
    return prisma.preAllocation.create({
      data,
      include: { employee: true },
    });
  }

  async update(
    id: string,
    data: {
      employeeId?: string;
      date?: Date;
      notes?: string | null;
    },
  ) {
    return prisma.preAllocation.update({
      where: { id },
      data,
      include: { employee: true, scheduleMonth: true },
    });
  }

  async delete(id: string) {
    return prisma.preAllocation.delete({ where: { id } });
  }

  async deleteMany(ids: string[]) {
    if (ids.length === 0) return { count: 0 };
    return prisma.preAllocation.deleteMany({ where: { id: { in: ids } } });
  }
}
