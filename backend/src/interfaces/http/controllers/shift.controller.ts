import type { FastifyReply, FastifyRequest } from "fastify";
import { ShiftHasOperationalHistoryError } from "../../../application/use-cases/shift-delete.js";
import { shiftUseCase } from "../../../application/use-cases/shift.use-case.js";
import { createShiftSchema, updateShiftSchema } from "../dto/shift.dto.js";

export async function listShiftsController(
  req: FastifyRequest<{ Querystring: { activeOnly?: string } }>,
  reply: FastifyReply,
) {
  const activeOnly = req.query.activeOnly === "true";
  const data = await shiftUseCase.list(activeOnly);
  return reply.send(data);
}

export async function getShiftController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const row = await shiftUseCase.getById(req.params.id);
  if (!row) return reply.status(404).send({ error: "Turno não encontrado" });
  return reply.send(row);
}

export async function createShiftController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createShiftSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const created = await shiftUseCase.create(parsed.data);
    return reply.status(201).send(created);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return reply.status(409).send({ error: "Código de turno já cadastrado", code: "SHIFT_CODE_EXISTS" });
    }
    throw err;
  }
}

export async function updateShiftController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateShiftSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const updated = await shiftUseCase.update(req.params.id, parsed.data);
    return reply.send(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Turno não encontrado" });
    }
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return reply.status(409).send({ error: "Código de turno já cadastrado", code: "SHIFT_CODE_EXISTS" });
    }
    throw err;
  }
}

export async function deleteShiftController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await shiftUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    if (err instanceof ShiftHasOperationalHistoryError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Turno não encontrado" });
    }
    return reply.status(400).send({ error: "Não foi possível excluir turno" });
  }
}
