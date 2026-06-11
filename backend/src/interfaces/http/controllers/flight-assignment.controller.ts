import type { FastifyReply, FastifyRequest } from "fastify";
import { flightAssignmentUseCase } from "../../../application/use-cases/flight-assignment.use-case.js";
import { createBatchDeleteHandler } from "./batch-delete.controller.js";
import {
  createFlightAssignmentBatchSchema,
  createFlightAssignmentSchema,
  updateFlightAssignmentSchema,
} from "../dto/flight-assignment.dto.js";

export async function listFlightAssignmentsController(_req: FastifyRequest, reply: FastifyReply) {
  const data = await flightAssignmentUseCase.list();
  return reply.send(data);
}

export async function createFlightAssignmentBatchController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createFlightAssignmentBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await flightAssignmentUseCase.createBatch(parsed.data);
    return reply.status(201).send(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar voos em lote";
    return reply.status(400).send({ error: msg });
  }
}

export async function createFlightAssignmentController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createFlightAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const created = await flightAssignmentUseCase.create(parsed.data);
    return reply.status(201).send(created);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar voo";
    if (String(msg).includes("Unique constraint")) {
      return reply.status(409).send({ error: "Já existe voo para este funcionário nesta data" });
    }
    return reply.status(400).send({ error: msg });
  }
}

export async function updateFlightAssignmentController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateFlightAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const updated = await flightAssignmentUseCase.update(req.params.id, parsed.data);
    return reply.send(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao atualizar voo";
    const status = msg.includes("não encontrado") ? 404 : 400;
    return reply.status(status).send({ error: msg });
  }
}

export async function deleteFlightAssignmentController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await flightAssignmentUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch {
    return reply.status(404).send({ error: "Voo não encontrado" });
  }
}

export const deleteFlightAssignmentBatchController = createBatchDeleteHandler((ids) =>
  flightAssignmentUseCase.removeBatch(ids),
);
