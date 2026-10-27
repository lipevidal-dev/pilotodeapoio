import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../../infrastructure/database/prisma-client.js";

const OBSERVATION_MAX = 500;

function normalizeObservation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, OBSERVATION_MAX);
}

export async function listEmployeeObservationsController(_req: FastifyRequest, reply: FastifyReply) {
  const rows = await prisma.$queryRaw<Array<{ employeeId: string; observation: string }>>`
    SELECT id AS "employeeId", observation
    FROM "Employee"
    WHERE observation IS NOT NULL AND btrim(observation) <> ''
  `;
  return reply.send({ items: rows });
}

export async function updateEmployeeObservationController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const id = req.params.id;
  const observation = normalizeObservation(
    (req.body as { observation?: unknown } | undefined)?.observation,
  );
  const found = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Employee" WHERE id = ${id} LIMIT 1
  `;
  if (!found[0]) {
    return reply.status(404).send({ error: "Funcionário não encontrado" });
  }
  await prisma.$executeRaw`
    UPDATE "Employee" SET observation = ${observation}, updated_at = NOW() WHERE id = ${id}
  `;
  return reply.send({ observation });
}
