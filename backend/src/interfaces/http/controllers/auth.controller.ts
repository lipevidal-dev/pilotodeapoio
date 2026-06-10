import type { FastifyReply, FastifyRequest } from "fastify";
import { authUseCase } from "../../../application/use-cases/auth.use-case.js";
import { InvalidAuthTokenError, InvalidCredentialsError } from "../../../application/errors/auth.errors.js";
import { loginSchema } from "../dto/auth.dto.js";

export async function loginController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await authUseCase.login(parsed.data.email, parsed.data.password);
    return reply.send(result);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}

export async function meController(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return reply.status(401).send({ error: "Token ausente", code: "UNAUTHORIZED" });
  }
  try {
    const user = await authUseCase.me(token);
    return reply.send({ user });
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}
