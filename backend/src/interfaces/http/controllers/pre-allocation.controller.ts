import type { FastifyReply, FastifyRequest } from "fastify";
import { preAllocationUseCase } from "../../../application/use-cases/pre-allocation.use-case.js";
import { InvalidPreAllocationLabelError } from "../../../domain/schedule/valid-preallocation-labels.js";
import {
  createPreAllocationBatchSchema,
  createPreAllocationSchema,
} from "../dto/pre-allocation.dto.js";

function handlePreAllocationError(err: unknown, reply: FastifyReply) {
  if (err instanceof InvalidPreAllocationLabelError) {
    return reply.status(400).send({ error: err.message, code: err.code });
  }
  const msg = err instanceof Error ? err.message : "Erro ao processar pré-alocação";
  return reply.status(400).send({ error: msg });
}

export async function listPreAllocationsController(
  req: FastifyRequest<{ Querystring: { scheduleMonthId?: string; year?: string; month?: string } }>,
  reply: FastifyReply,
) {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  const data = await preAllocationUseCase.list({
    scheduleMonthId: req.query.scheduleMonthId,
    year: Number.isInteger(year) ? year : undefined,
    month: Number.isInteger(month) && month! >= 1 && month! <= 12 ? month : undefined,
  });
  return reply.send(data);
}

export async function createPreAllocationBatchController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createPreAllocationBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await preAllocationUseCase.createBatch(parsed.data);
    return reply.status(201).send(result);
  } catch (err) {
    return handlePreAllocationError(err, reply);
  }
}

export async function createPreAllocationController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createPreAllocationSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const created = await preAllocationUseCase.create(parsed.data);
    return reply.status(201).send(created);
  } catch (err) {
    return handlePreAllocationError(err, reply);
  }
}

export async function deletePreAllocationController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await preAllocationUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch {
    return reply.status(404).send({ error: "Pré-alocação não encontrada" });
  }
}
