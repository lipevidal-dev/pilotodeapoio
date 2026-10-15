import type { FastifyRequest } from "fastify";
import { InvalidAuthTokenError } from "../../../application/errors/auth.errors.js";
import { authUseCase, type AuthUserDto } from "../../../application/use-cases/auth.use-case.js";

export async function requireAuthUser(req: FastifyRequest): Promise<AuthUserDto> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    throw new InvalidAuthTokenError();
  }
  return authUseCase.me(token);
}
