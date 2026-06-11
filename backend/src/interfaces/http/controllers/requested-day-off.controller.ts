import type { FastifyReply, FastifyRequest } from "fastify";
import { requestedDayOffUseCase } from "../../../application/use-cases/requested-day-off.use-case.js";
import { createBatchDeleteHandler } from "./batch-delete.controller.js";
import {
  createRequestedDayOffBatchSchema,
  createRequestedDayOffSchema,
  updateRequestedDayOffSchema,
} from "../dto/requested-day-off.dto.js";

export async function listRequestedDayOffsController(_req: FastifyRequest, reply: FastifyReply) {
  const data = await requestedDayOffUseCase.list();
  return reply.send(data);
}

export async function createRequestedDayOffController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createRequestedDayOffSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  const created = await requestedDayOffUseCase.create(parsed.data);
  return reply.status(201).send(created);
}

export async function createRequestedDayOffBatchController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createRequestedDayOffBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await requestedDayOffUseCase.createBatch(parsed.data);
    return reply.status(201).send(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar FPs em lote";
    return reply.status(400).send({ error: msg });
  }
}

export async function updateRequestedDayOffController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateRequestedDayOffSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const updated = await requestedDayOffUseCase.update(req.params.id, parsed.data);
    return reply.send(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao atualizar folga pedida";
    const status = msg.includes("não encontrada") ? 404 : 400;
    return reply.status(status).send({ error: msg });
  }
}

export async function deleteRequestedDayOffController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await requestedDayOffUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch {
    return reply.status(404).send({ error: "Folga pedida não encontrada" });
  }
}

export const deleteRequestedDayOffBatchController = createBatchDeleteHandler((ids) =>
  requestedDayOffUseCase.removeBatch(ids),
);
