import { prisma } from "../database/prisma-client.js";

export const userRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },
};
