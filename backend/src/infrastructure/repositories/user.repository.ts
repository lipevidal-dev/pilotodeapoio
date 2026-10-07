import type { UserRole } from "@prisma/client";
import { prisma } from "../database/prisma-client.js";
import { normalizePortalLogin } from "../../domain/auth/portal-login.js";

export const userRepository = {
  findByEmail(email: string) {
    return prisma.user.findFirst({
      where: { email: { equals: email.toLowerCase().trim(), mode: "insensitive" } },
    });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  /** Localiza pelo login do portal ou pelo e-mail (admins). */
  async findByLogin(login: string) {
    const normalized = normalizePortalLogin(login);
    if (!normalized) return null;
    const byLogin = await prisma.user.findFirst({
      where: { login: { equals: normalized, mode: "insensitive" } },
    });
    if (byLogin) return byLogin;
    return prisma.user.findFirst({
      where: { email: { equals: normalized, mode: "insensitive" } },
    });
  },

  findPortalUserByEmployeeId(employeeId: string) {
    return prisma.user.findFirst({
      where: { employeeId, role: { not: "ADMIN" } },
      orderBy: { createdAt: "asc" },
    });
  },

  createPortalUser(data: {
    employeeId: string;
    name: string;
    login: string;
    passwordHash: string;
    role?: UserRole;
  }) {
    return prisma.user.create({
      data: {
        name: data.name,
        email: data.login,
        login: data.login,
        passwordHash: data.passwordHash,
        role: data.role ?? "OPERATOR",
        employeeId: data.employeeId,
      },
    });
  },

  updatePortalUser(
    id: string,
    data: {
      employeeId: string;
      name: string;
      login: string;
      email?: string;
      passwordHash?: string;
    },
  ) {
    return prisma.user.update({
      where: { id },
      data: {
        employeeId: data.employeeId,
        name: data.name,
        login: data.login,
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.passwordHash !== undefined ? { passwordHash: data.passwordHash } : {}),
      },
    });
  },

  deleteById(id: string) {
    return prisma.user.delete({ where: { id } });
  },
};
