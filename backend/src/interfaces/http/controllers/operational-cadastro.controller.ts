import type { FastifyReply, FastifyRequest } from "fastify";
import { scheduleUseCase } from "../../../application/use-cases/schedule.use-case.js";

export async function debugOperationalCadastrosController(
  req: FastifyRequest<{
    Querystring: { year?: string; month?: string };
  }>,
  reply: FastifyReply,
) {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month! < 1 ||
    month! > 12
  ) {
    return reply.status(400).send({ error: "Informe year e month válidos" });
  }

  const data = await scheduleUseCase.getOperationalCadastrosDebug(year!, month!);
  return reply.send(data);
}

export async function listOperationalCadastrosController(
  req: FastifyRequest<{
    Querystring: { year?: string; month?: string; employeeId?: string };
  }>,
  reply: FastifyReply,
) {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month! < 1 ||
    month! > 12
  ) {
    return reply.status(400).send({ error: "Informe year e month válidos" });
  }

  const data = await scheduleUseCase.getOperationalCadastros(
    year!,
    month!,
    req.query.employeeId,
  );
  return reply.send(data);
}
