import type { EmployeeTypeAllowed } from "@prisma/client";
import { prisma } from "../database/prisma-client.js";

export interface ShiftWriteData {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  employeeTypeAllowed: EmployeeTypeAllowed;
  active?: boolean;
  displayOrder?: number;
  mandatoryCoverage?: boolean;
  requiresT8PairNd?: boolean;
}

export class ShiftRepository {
  async findAll(activeOnly = false) {
    return prisma.shift.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
  }

  async findById(id: string) {
    return prisma.shift.findUnique({ where: { id } });
  }

  async findByCode(code: string) {
    return prisma.shift.findUnique({ where: { code } });
  }

  async create(data: ShiftWriteData) {
    return prisma.shift.create({ data });
  }

  async update(id: string, data: Partial<ShiftWriteData>) {
    return prisma.shift.update({ where: { id }, data });
  }

  async countOperationalHistory(shiftCode: string) {
    const scheduleAssignments = await prisma.scheduleAssignment.count({
      where: { shiftCode },
    });
    return { scheduleAssignments };
  }

  async delete(id: string) {
    return prisma.shift.delete({ where: { id } });
  }
}
