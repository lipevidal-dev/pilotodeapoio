import type { FastifyReply, FastifyRequest } from "fastify";
import { vacationUseCase } from "../../../application/use-cases/vacation.use-case.js";
import { createBatchDeleteHandler } from "./batch-delete.controller.js";
import { createVacationBatchSchema, createVacationSchema, updateVacationSchema } from "../dto/vacation.dto.js";

export async function listVacationsController(_req: FastifyRequest, reply: FastifyReply) {
  const data = await vacationUseCase.list();
  return reply.send(data);
}

export async function createVacationBatchController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createVacationBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await vacationUseCase.createBatch(parsed.data);
    return reply.status(201).send(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar férias em lote";
    return reply.status(400).send({ error: msg });
  }
}

export async function createVacationController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createVacationSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const created = await vacationUseCase.create(parsed.data);
    return reply.status(201).send(created);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar férias";
    return reply.status(400).send({ error: msg });
  }
}

export async function updateVacationController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateVacationSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const updated = await vacationUseCase.update(req.params.id, parsed.data);
    return reply.send(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao atualizar férias";
    const status = msg.includes("não encontradas") ? 404 : 400;
    return reply.status(status).send({ error: msg });
  }
}

export async function deleteVacationController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await vacationUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch {
    return reply.status(404).send({ error: "Férias não encontradas" });
  }
}

export const deleteVacationBatchController = createBatchDeleteHandler((ids) =>
  vacationUseCase.removeBatch(ids),
);
