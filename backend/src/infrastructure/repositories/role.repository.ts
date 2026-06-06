import { prisma } from "../database/prisma-client.js";

export interface RoleWriteData {
  name: string;
  code: string;
  description?: string | null;
  active?: boolean;
  displayOrder?: number;
}

export class RoleRepository {
  async findAll(activeOnly = false) {
    return prisma.role.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
  }

  async findById(id: string) {
    return prisma.role.findUnique({ where: { id } });
  }

  async findByCode(code: string) {
    return prisma.role.findUnique({ where: { code: code.toUpperCase() } });
  }

  async create(data: RoleWriteData) {
    return prisma.role.create({
      data: {
        ...data,
        code: data.code.toUpperCase(),
      },
    });
  }

  async update(id: string, data: Partial<RoleWriteData>) {
    const patch = { ...data };
    if (patch.code !== undefined) patch.code = patch.code.toUpperCase();
    return prisma.role.update({ where: { id }, data: patch });
  }

  async countEmployees(roleId: string) {
    return prisma.employee.count({ where: { roleId } });
  }

  async delete(id: string) {
    return prisma.role.delete({ where: { id } });
  }
}
