import type { EmployeeType } from "@prisma/client";
import { toDbDate } from "../../domain/rules/date-keys.js";
import { prisma } from "../database/prisma-client.js";

const employeeInclude = { role: true } as const;

export class EmployeeRepository {
  async findAll(activeOnly = false) {
    return prisma.employee.findMany({
      where: activeOnly ? { active: true } : undefined,
      include: employeeInclude,
      orderBy: { name: "asc" },
    });
  }

  async findById(id: string) {
    return prisma.employee.findUnique({
      where: { id },
      include: employeeInclude,
    });
  }

  async create(data: {
    name: string;
    type: EmployeeType;
    roleId?: string | null;
    birthDate?: string | null;
    active?: boolean;
  }) {
    const { birthDate, ...rest } = data;
    return prisma.employee.create({
      data: {
        ...rest,
        birthDate: birthDate ? toDbDate(birthDate) : null,
      },
      include: employeeInclude,
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      type?: EmployeeType;
      roleId?: string | null;
      birthDate?: string | null;
      active?: boolean;
    },
  ) {
    const { birthDate, ...rest } = data;
    const patch = { ...rest } as Parameters<typeof prisma.employee.update>[0]["data"];
    if (birthDate !== undefined) {
      patch.birthDate = birthDate ? toDbDate(birthDate) : null;
    }
    return prisma.employee.update({
      where: { id },
      data: patch,
      include: employeeInclude,
    });
  }

  async countOperationalHistory(employeeId: string) {
    const [scheduleAssignments, vacations, requestedDaysOff, flightAssignments, preAllocations] =
      await Promise.all([
        prisma.scheduleAssignment.count({ where: { employeeId } }),
        prisma.vacation.count({ where: { employeeId } }),
        prisma.requestedDayOff.count({ where: { employeeId } }),
        prisma.flightAssignment.count({ where: { employeeId } }),
        prisma.preAllocation.count({ where: { employeeId } }),
      ]);
    return { scheduleAssignments, vacations, requestedDaysOff, flightAssignments, preAllocations };
  }

  async delete(id: string) {
    return prisma.employee.delete({ where: { id } });
  }
}
