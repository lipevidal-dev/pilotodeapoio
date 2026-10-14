import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InvalidAuthTokenError } from "../../../application/errors/auth.errors.js";
import {
  FlightPlanningClosedError,
  FlightPlanningInvalidError,
  FlightPlanningNotLinkedError,
  flightPlanningUseCase,
} from "../../../application/use-cases/flight-planning.use-case.js";
import { ForbiddenError, requireAdminUser } from "../middleware/require-admin.js";
import { requireAuthUser } from "../middleware/require-auth.js";

const submitSchema = z.object({
  lines: z
    .array(
      z.object({
        date: z.string(),
        description: z.string(),
      }),
    )
    .min(1)
    .max(40),
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
});

const adminQuerySchema = z.object({
  packageId: z.string().optional(),
});

function authError(err: unknown, reply: FastifyReply) {
  if (err instanceof InvalidAuthTokenError) {
    return reply.status(401).send({ error: err.message, code: err.code });
  }
  if (err instanceof ForbiddenError) {
    return reply.status(403).send({ error: err.message, code: err.code });
  }
  return null;
}

export async function getPortalFlightPlanningStatusController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAuthUser(req);
  } catch (err) {
    const response = authError(err, reply);
    if (response) return response;
    throw err;
  }
  const enabled = await flightPlanningUseCase.isEnabled();
  return reply.send({ enabled });
}

export async function submitPortalFlightPlanningController(req: FastifyRequest, reply: FastifyReply) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    const response = authError(err, reply);
    if (response) return response;
    throw err;
  }

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Preencha data e solicitação do voo em cada linha." });
  }

  try {
    const created = await flightPlanningUseCase.submit(user.id, parsed.data.lines);
    return reply.status(201).send(created);
  } catch (err) {
    if (
      err instanceof FlightPlanningClosedError ||
      err instanceof FlightPlanningNotLinkedError ||
      err instanceof FlightPlanningInvalidError
    ) {
      const status = err instanceof FlightPlanningInvalidError ? 400 : 403;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Não foi possível enviar a solicitação." });
  }
}

export async function getAdminFlightPlanningController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAdminUser(req);
  } catch (err) {
    const response = authError(err, reply);
    if (response) return response;
    throw err;
  }
  const query = adminQuerySchema.safeParse(req.query);
  try {
    return reply.send(await flightPlanningUseCase.listForAdmin(query.success ? query.data.packageId : undefined));
  } catch (err) {
    if (err instanceof FlightPlanningInvalidError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}

export async function updateAdminFlightPlanningSettingsController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAdminUser(req);
  } catch (err) {
    const response = authError(err, reply);
    if (response) return response;
    throw err;
  }

  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Informe se o menu deve ficar habilitado." });
  }
  try {
    const result = await flightPlanningUseCase.setEnabled(parsed.data.enabled, {
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn,
    });
    return reply.send(result);
  } catch (err) {
    if (err instanceof FlightPlanningInvalidError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}
