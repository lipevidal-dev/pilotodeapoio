import type { FastifyReply, FastifyRequest } from "fastify";
import { validateScheduleService } from "../../../application/services/validate-schedule.service.js";
import { scheduleUseCase } from "../../../application/use-cases/schedule.use-case.js";
import { generateScheduleUseCase } from "../../../application/use-cases/generate-schedule.use-case.js";
import { generateScheduleByStepsUseCase } from "../../../application/use-cases/generate-schedule-by-steps.use-case.js";
import { generateFlightsUseCase } from "../../../application/use-cases/generate-flights.use-case.js";
import { generateApaoScheduleUseCase } from "../../../application/use-cases/generate-apao-schedule.use-case.js";
import { publishScheduleUseCase } from "../../../application/use-cases/publish-schedule.use-case.js";
import { clearGeneratedScheduleUseCase } from "../../../application/use-cases/clear-generated-schedule.use-case.js";
import {
  PublishedScheduleCannotBeClearedError,
  PublishedScheduleCannotRegenerateError,
  PublishBlockedCriticalViolationsError,
  ScheduleCannotPublishError,
  ScheduleMonthNotFoundError,
  ScheduleNotGeneratedError,
  ScheduleNotPublishedError,
} from "../../../application/errors/schedule.errors.js";
import { dtoToScheduleContext } from "../../../infrastructure/mappers/schedule-context.mapper.js";
import {
  mapScheduleEmployees,
  mapScheduleShifts,
} from "../../../infrastructure/mappers/schedule-api.mapper.js";
import {
  generateScheduleBodySchema,
  generateScheduleByStepsBodySchema,
  validateScheduleBodySchema,
} from "../dto/schedule.dto.js";

export async function validateScheduleController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = validateScheduleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "ScheduleContext inválido", details: parsed.error.flatten() });
  }

  const ctx = dtoToScheduleContext(parsed.data);
  const result = validateScheduleService.execute(ctx);
  return reply.send(result);
}

export async function getScheduleMonthController(
  req: FastifyRequest<{ Params: { year: string; month: string } }>,
  reply: FastifyReply,
) {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return reply.status(400).send({ error: "Ano/mês inválidos" });
  }

  try {
    const data = await scheduleUseCase.getMonth(year, month);
    return reply.send({
      scheduleMonth: data.scheduleMonth,
      employees: mapScheduleEmployees(data.employees),
      shifts: mapScheduleShifts(data.shifts),
      assignments: data.assignments,
      preAllocations: data.preAllocations,
      operationalCadastros: data.operationalCadastros,
      ruleViolations: data.ruleViolations,
      validation: data.validation,
    });
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao carregar escala" });
  }
}

export async function generateScheduleByStepsController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = generateScheduleByStepsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await generateScheduleByStepsUseCase.execute(
      parsed.data.year,
      parsed.data.month,
      parsed.data.steps,
    );
    return reply.status(200).send(result);
  } catch (err) {
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao gerar escala por etapas" });
  }
}

export async function generateScheduleController(req: FastifyRequest, reply: FastifyReply) {
  const parsed = generateScheduleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }

  try {
    const result = await generateScheduleUseCase.execute(parsed.data.year, parsed.data.month);
    return reply.status(200).send(result);
  } catch (err) {
    if (err instanceof PublishedScheduleCannotRegenerateError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao gerar escala" });
  }
}

export async function publishScheduleController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const result = await publishScheduleUseCase.execute(req.params.id);
    return reply.send(result);
  } catch (err) {
    if (err instanceof ScheduleMonthNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    if (err instanceof ScheduleCannotPublishError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    if (err instanceof PublishBlockedCriticalViolationsError) {
      return reply.status(409).send({
        code: err.code,
        message: err.message,
        criticalViolations: err.criticalViolations,
      });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao publicar escala" });
  }
}

export async function generateApaoScheduleController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const result = await generateApaoScheduleUseCase.execute(req.params.id);
    return reply.status(200).send(result);
  } catch (err) {
    if (err instanceof ScheduleMonthNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    if (err instanceof ScheduleNotGeneratedError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao gerar escala APAO" });
  }
}

export async function generateFlightsController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const result = await generateFlightsUseCase.execute(req.params.id);
    return reply.status(200).send(result);
  } catch (err) {
    if (err instanceof ScheduleMonthNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    if (err instanceof ScheduleNotGeneratedError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao gerar voos" });
  }
}

export async function clearGeneratedScheduleController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const result = await clearGeneratedScheduleUseCase.execute(req.params.id);
    return reply.send(result);
  } catch (err) {
    if (err instanceof ScheduleMonthNotFoundError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    if (err instanceof PublishedScheduleCannotBeClearedError) {
      return reply.status(409).send({ error: err.message, code: err.code });
    }
    if (err instanceof ScheduleNotGeneratedError) {
      return reply.status(400).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao limpar geração" });
  }
}

export async function getPublishedScheduleController(
  req: FastifyRequest<{ Params: { year: string; month: string } }>,
  reply: FastifyReply,
) {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return reply.status(400).send({ error: "Ano/mês inválidos" });
  }

  try {
    const data = await scheduleUseCase.getPublishedMonth(year, month);
    return reply.send({
      scheduleMonth: data.scheduleMonth,
      employees: mapScheduleEmployees(data.employees),
      shifts: mapScheduleShifts(data.shifts),
      assignments: data.assignments,
      preAllocations: data.preAllocations,
    });
  } catch (err) {
    if (err instanceof ScheduleNotPublishedError) {
      return reply.status(404).send({ error: err.message, code: err.code });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "Erro ao carregar escala publicada" });
  }
}
