import type { FastifyReply, FastifyRequest } from "fastify";
import { APP_VERSION } from "../../../app-version.js";

export async function healthController(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    status: "ok",
    service: "escala-pao-backend",
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  });
}