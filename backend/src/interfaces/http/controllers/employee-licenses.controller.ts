import type { FastifyReply, FastifyRequest } from "fastify";
import { InvalidAuthTokenError } from "../../../application/errors/auth.errors.js";
import {
  EmployeeLicenseValidationError,
  employeeLicensesUseCase,
} from "../../../application/use-cases/employee-licenses.use-case.js";
import { ForbiddenError, requireAdminUser } from "../middleware/require-admin.js";

async function adminOrReply(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await requireAdminUser(req);
    return true;
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      reply.status(401).send({ error: err.message, code: err.code });
      return false;
    }
    if (err instanceof ForbiddenError) {
      reply.status(403).send({ error: err.message, code: err.code });
      return false;
    }
    throw err;
  }
}

export async function listEmployeeLicenseAlertsController(req: FastifyRequest, reply: FastifyReply) {
  if (!(await adminOrReply(req, reply))) return;
  const data = await employeeLicensesUseCase.listAlerts();
  return reply.send(data);
}

export async function getEmployeeLicensesController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  if (!(await adminOrReply(req, reply))) return;
  const data = await employeeLicensesUseCase.listForEmployee(req.params.id);
  if (!data) return reply.status(404).send({ error: "Funcionário não encontrado" });
  return reply.send(data);
}

export async function replaceEmployeeLicensesController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  if (!(await adminOrReply(req, reply))) return;
  try {
    const data = await employeeLicensesUseCase.replace(req.params.id, req.body);
    return reply.send(data);
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return reply.status(404).send({ error: "Funcionário não encontrado" });
    }
    if (err instanceof EmployeeLicenseValidationError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}
