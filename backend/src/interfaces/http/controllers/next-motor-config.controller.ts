import type { FastifyReply, FastifyRequest } from "fastify";
import { nextMotorConfigUseCase } from "../../../application/use-cases/next-motor-config.use-case.js";
import { updateNextMotorConfigSchema } from "../dto/next-motor-config.dto.js";

export async function getNextMotorConfigController(_req: FastifyRequest, reply: FastifyReply) {
  const data = await nextMotorConfigUseCase.getConfig();
  return reply.send(data);
}

export async function updateNextMotorConfigController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = updateNextMotorConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  const data = await nextMotorConfigUseCase.updateConfig(parsed.data);
  return reply.send(data);
}
