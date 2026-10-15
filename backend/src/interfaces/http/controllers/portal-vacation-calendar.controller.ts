import type { FastifyReply, FastifyRequest } from "fastify";
import { InvalidAuthTokenError } from "../../../application/errors/auth.errors.js";
import { vacationUseCase } from "../../../application/use-cases/vacation.use-case.js";
import { userRepository } from "../../../infrastructure/repositories/user.repository.js";
import { requireAuthUser } from "../middleware/require-auth.js";

export async function getPortalVacationCalendarController(
  req: FastifyRequest<{ Querystring: { year?: string; month?: string } }>,
  reply: FastifyReply,
) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2020 || year > 2100) {
    return reply.status(400).send({ error: "Ano/mês inválidos" });
  }

  try {
    const dbUser = await userRepository.findById(user.id);
    const data = await vacationUseCase.portalCalendar(year, month, dbUser?.employeeId ?? null);
    return reply.send(data);
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao carregar o calendário de férias" });
  }
}
