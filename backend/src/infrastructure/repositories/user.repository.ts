import { prisma } from "../database/prisma-client.js";

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export const userRepository = {
  async findByEmail(email: string) {
    const normalized = email.toLowerCase().trim();
    const direct = await prisma.user.findUnique({ where: { email: normalized } });
    if (direct) return direct;

    const stripped = stripDiacritics(normalized);
    if (stripped !== normalized) {
      const byStripped = await prisma.user.findUnique({ where: { email: stripped } });
      if (byStripped) return byStripped;
    }

    const candidates = await prisma.user.findMany();
    return (
      candidates.find((u) => stripDiacritics(u.email.toLowerCase().trim()) === stripped) ?? null
    );
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },
};
