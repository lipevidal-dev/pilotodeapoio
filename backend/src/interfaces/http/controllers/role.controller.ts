import type { FastifyReply, FastifyRequest } from "fastify";
import { RoleInUseError } from "../../../application/use-cases/role-delete.js";
import { roleUseCase } from "../../../application/use-cases/role.use-case.js";
import { createRoleSchema, updateRoleSchema } from "../dto/role.dto.js";

export async function listRolesController(
  req: FastifyRequest<{ Querystring: { activeOnly?: string } }>,
  reply: FastifyReply,
) {
  const activeOnly = req.query.activeOnly === "true";
  const data = await roleUseCase.list(activeOnly);
  return reply.send(data);
}

export async function getRoleController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const row = await roleUseCase.getById(req.params.id);
  if (!row) return reply.status(404).send({ error: "Cargo não encontrado" });
  return reply.send(row);
}

export async function createRoleController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const created = await roleUseCase.create(parsed.data);
    return reply.status(201).send(created);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return reply.status(409).send({ error: "Código de cargo já cadastrado", code: "ROLE_CODE_EXISTS" });
    }
    throw err;
  }
}

export async function updateRoleController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const updated = await roleUseCase.update(req.params.id, parsed.data);
    return reply.send(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Cargo não encontrado" });
    }
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return reply.status(409).send({ error: "Código de cargo já cadastrado", code: "ROLE_CODE_EXISTS" });
    }
    throw err;
  }
}

export async function deleteRoleController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await roleUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    if (err instanceof RoleInUseError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Cargo não encontrado" });
    }
    return reply.status(400).send({ error: "Não foi possível excluir cargo" });
  }
}
