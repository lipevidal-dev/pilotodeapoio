import type { FastifyReply, FastifyRequest } from "fastify";

export async function healthController(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    status: "ok",
    service: "escala-pao-backend",
    version: "0.2.0",
    timestamp: new Date().toISOString(),
  });
}
