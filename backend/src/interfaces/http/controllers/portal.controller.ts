import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InvalidAuthTokenError } from "../../../application/errors/auth.errors.js";
import {
  EmployeeNotLinkedError,
  PortalFpMonthlyLimitExceededError,
  PortalRequestNotFoundError,
  portalRequestUseCase,
  type PortalRequestType,
} from "../../../application/use-cases/portal-request.use-case.js";
import { scheduleUseCase } from "../../../application/use-cases/schedule.use-case.js";
import { MAX_REQUESTED_OFF_PER_MONTH } from "../../../domain/rules/constants.js";
import {
  mapScheduleReadPayload,
} from "../../../infrastructure/mappers/schedule-api.mapper.js";
import { requireAuthUser } from "../middleware/require-auth.js";
import { ForbiddenError, requireAdminUser } from "../middleware/require-admin.js";
import {
  PortalShiftNotAvailableError,
  PortalShiftPreferenceInvalidError,
  portalShiftPreferenceUseCase,
} from "../../../application/use-cases/portal-shift-preference.use-case.js";

const portalRequestSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum([
    "FP",
    "VOO",
    "SIMULADOR",
    "CURSO",
    "CMA",
    "OUTRO",
    "FOLGA",
    "FS",
    "FA",
    "FANI",
    "ND",
    "FERIAS",
    "TURNO",
  ]),
  notes: z.string().max(500).optional(),
  thirteenthAdvanceRequested: z.boolean().optional(),
  sellTenDaysRequested: z.boolean().optional(),
});

const portalCancelRequestSchema = portalRequestSchema.extend({
  requestId: z.string().uuid().optional(),
});

export async function getPortalScheduleController(
  req: FastifyRequest<{ Params: { year: string; month: string } }>,
  reply: FastifyReply,
) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return reply.status(400).send({ error: "Ano/mês inválidos" });
  }

  try {
    const employeeId = await portalRequestUseCase.resolveEmployeeId(user.id);
    const [data, portalFpRequestedCount] = await Promise.all([
      scheduleUseCase.getPortalScheduleForEmployee(employeeId, year, month),
      portalRequestUseCase.countPortalFpRequests(employeeId, year, month),
    ]);
    return reply.send(
      mapScheduleReadPayload({
        ...data,
        portalFpRequestedCount,
        portalFpRequestedLimit: MAX_REQUESTED_OFF_PER_MONTH,
      }),
    );
  } catch (err) {
    if (err instanceof EmployeeNotLinkedError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao carregar escala do portal" });
  }
}

export async function listPendingPortalRequestsController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAdminUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    if (err instanceof ForbiddenError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  try {
    const rows = await portalRequestUseCase.listPendingRequests();
    return reply.send(rows);
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao listar solicitações pendentes" });
  }
}

export async function listRegisteredApaoPortalFolgasController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAdminUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    if (err instanceof ForbiddenError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  try {
    const rows = await portalRequestUseCase.listRegisteredApaoPortalFolgas();
    return reply.send(rows);
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao listar folgas APAO cadastradas" });
  }
}

export async function createPortalRequestController(req: FastifyRequest, reply: FastifyReply) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const parsed = portalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await portalRequestUseCase.createRequest({
      userId: user.id,
      year: parsed.data.year,
      month: parsed.data.month,
      date: parsed.data.date,
      endDate: parsed.data.endDate,
      type: parsed.data.type as PortalRequestType,
      notes: parsed.data.notes,
      thirteenthAdvanceRequested: parsed.data.thirteenthAdvanceRequested,
      sellTenDaysRequested: parsed.data.sellTenDaysRequested,
    });
    return reply.status(201).send(result);
  } catch (err) {
    if (err instanceof EmployeeNotLinkedError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    if (err instanceof PortalFpMonthlyLimitExceededError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    const message = err instanceof Error ? err.message : "Erro ao registrar solicitação";
    return reply.status(400).send({ error: message });
  }
}

export async function cancelPortalRequestController(req: FastifyRequest, reply: FastifyReply) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const parsed = portalCancelRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await portalRequestUseCase.cancelRequest({
      userId: user.id,
      year: parsed.data.year,
      month: parsed.data.month,
      date: parsed.data.date,
      type: parsed.data.type as PortalRequestType,
      requestId: parsed.data.requestId,
    });
    return reply.send(result);
  } catch (err) {
    if (err instanceof EmployeeNotLinkedError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    if (err instanceof PortalRequestNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    const message = err instanceof Error ? err.message : "Erro ao excluir solicitação";
    return reply.status(400).send({ error: message });
  }
}

const adminPortalDecisionSchema = portalRequestSchema.extend({
  employeeId: z.string().uuid(),
});

export async function approvePortalRequestController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAdminUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    if (err instanceof ForbiddenError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const parsed = adminPortalDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await portalRequestUseCase.approveRequest({
      employeeId: parsed.data.employeeId,
      year: parsed.data.year,
      month: parsed.data.month,
      date: parsed.data.date,
      type: parsed.data.type as PortalRequestType,
    });
    return reply.send(result);
  } catch (err) {
    if (err instanceof PortalRequestNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    const message = err instanceof Error ? err.message : "Erro ao aprovar solicitação";
    return reply.status(400).send({ error: message });
  }
}

export async function rejectPortalRequestController(req: FastifyRequest, reply: FastifyReply) {
  try {
    await requireAdminUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    if (err instanceof ForbiddenError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const parsed = adminPortalDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await portalRequestUseCase.rejectRequest({
      employeeId: parsed.data.employeeId,
      year: parsed.data.year,
      month: parsed.data.month,
      date: parsed.data.date,
      type: parsed.data.type as PortalRequestType,
    });
    return reply.send(result);
  } catch (err) {
    if (err instanceof PortalRequestNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    const message = err instanceof Error ? err.message : "Erro ao rejeitar solicitação";
    return reply.status(400).send({ error: message });
  }
}

export async function getPortalProfileController(req: FastifyRequest, reply: FastifyReply) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  try {
    const employeeId = await portalRequestUseCase.resolveEmployeeId(user.id);
    return reply.send({
      user: { ...user, employeeId },
      employeeId,
    });
  } catch (err) {
    if (err instanceof EmployeeNotLinkedError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    throw err;
  }
}

const portalShiftPreferenceSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  shiftId: z.string().uuid().nullable(),
});

export async function getPortalShiftPreferencesController(
  req: FastifyRequest<{ Params: { year: string } }>,
  reply: FastifyReply,
) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const year = Number(req.params.year);
  if (!Number.isInteger(year)) {
    return reply.status(400).send({ error: "Ano inválido" });
  }

  try {
    const data = await portalShiftPreferenceUseCase.getYearPreferences(user.id, year);
    return reply.send(data);
  } catch (err) {
    if (err instanceof EmployeeNotLinkedError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    if (err instanceof PortalShiftPreferenceInvalidError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao carregar preferências de turno" });
  }
}

export async function setPortalShiftPreferenceController(req: FastifyRequest, reply: FastifyReply) {
  let user;
  try {
    user = await requireAuthUser(req);
  } catch (err) {
    if (err instanceof InvalidAuthTokenError) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  const parsed = portalShiftPreferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await portalShiftPreferenceUseCase.setMonthPreference({
      userId: user.id,
      year: parsed.data.year,
      month: parsed.data.month,
      shiftId: parsed.data.shiftId,
    });
    return reply.send(result);
  } catch (err) {
    if (err instanceof EmployeeNotLinkedError) {
      return reply.status(403).send({ error: err.message, code: err.code });
    }
    if (err instanceof PortalShiftNotAvailableError || err instanceof PortalShiftPreferenceInvalidError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao salvar preferência de turno" });
  }
}
