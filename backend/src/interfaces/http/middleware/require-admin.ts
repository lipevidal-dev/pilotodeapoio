import type { FastifyRequest } from "fastify";
import { requireAuthUser } from "./require-auth.js";

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";

  constructor() {
    super("Acesso negado. Apenas administradores podem executar esta ação.");
    this.name = "ForbiddenError";
  }
}

export async function requireAdminUser(req: FastifyRequest) {
  const user = await requireAuthUser(req);
  if (user.role !== "ADMIN") {
    throw new ForbiddenError();
  }
  return user;
}
