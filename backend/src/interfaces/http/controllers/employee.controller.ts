import type { FastifyReply, FastifyRequest } from "fastify";
import { EmployeeHasOperationalHistoryError } from "../../../application/use-cases/employee-delete.js";
import { employeeUseCase } from "../../../application/use-cases/employee.use-case.js";
import {
  EmployeeDuplicatePreferredShiftError,
  EmployeePreferredShiftNotFoundError,
  EmployeeShiftPreferenceConflictError,
} from "../../../application/errors/employee.errors.js";
import {
  RoleInactiveError,
  RoleNotFoundError,
  UnsupportedMotorRoleError,
} from "../../../application/errors/role.errors.js";
import { createEmployeeSchema, updateEmployeeSchema } from "../dto/employee.dto.js";

export async function listEmployeesController(_req: FastifyRequest, reply: FastifyReply) {
  const data = await employeeUseCase.list();
  return reply.send(data);
}

export async function getEmployeeController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const row = await employeeUseCase.getById(req.params.id);
  if (!row) return reply.status(404).send({ error: "Funcionário não encontrado" });
  return reply.send(row);
}

export async function createEmployeeController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = createEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const created = await employeeUseCase.create(parsed.data);
    return reply.status(201).send(created);
  } catch (err) {
    if (err instanceof RoleNotFoundError) {
      return reply.status(404).send({ error: err.message });
    }
    if (err instanceof RoleInactiveError || err instanceof UnsupportedMotorRoleError) {
      return reply.status(400).send({ error: err.message });
    }
    if (
      err instanceof EmployeeShiftPreferenceConflictError ||
      err instanceof EmployeePreferredShiftNotFoundError ||
      err instanceof EmployeeDuplicatePreferredShiftError
    ) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}

export async function updateEmployeeController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const updated = await employeeUseCase.update(req.params.id, parsed.data);
    return reply.send(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Funcionário não encontrado" });
    }
    if (err instanceof RoleNotFoundError) {
      return reply.status(404).send({ error: err.message });
    }
    if (err instanceof UnsupportedMotorRoleError) {
      return reply.status(400).send({ error: err.message });
    }
    if (
      err instanceof EmployeeShiftPreferenceConflictError ||
      err instanceof EmployeePreferredShiftNotFoundError ||
      err instanceof EmployeeDuplicatePreferredShiftError
    ) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}

export async function deleteEmployeeController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    await employeeUseCase.remove(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    if (err instanceof EmployeeHasOperationalHistoryError) {
      return reply.status(409).send({
        error: err.message,
        code: err.code,
        history: err.history,
      });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Funcionário não encontrado" });
    }
    return reply.status(400).send({ error: "Não foi possível excluir funcionário" });
  }
}
