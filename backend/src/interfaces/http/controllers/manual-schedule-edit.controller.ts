import type { FastifyReply, FastifyRequest } from "fastify";
import { ScheduleMonthNotFoundError } from "../../../application/errors/schedule.errors.js";
import {
  ManualEditBlockedError,
  SchedulePublishedCannotEditError,
} from "../../../application/errors/manual-edit.errors.js";
import { manualScheduleEditUseCase } from "../../../application/use-cases/manual-schedule-edit.use-case.js";
import {
  manualCellBodySchema,
  manualMoveBodySchema,
  manualRangeBodySchema,
} from "../dto/manual-schedule-edit.dto.js";
import {
  mapScheduleEmployees,
  mapScheduleShifts,
} from "../../../infrastructure/mappers/schedule-api.mapper.js";

function mapManualEditResult(result: Awaited<ReturnType<typeof manualScheduleEditUseCase.editCell>>) {
  return {
    success: result.success,
    applied: result.applied,
    conflicts: result.conflicts,
    warnings: result.warnings,
    scheduleMonth: result.scheduleMonth,
    employees: mapScheduleEmployees(result.employees),
    shifts: mapScheduleShifts(result.shifts),
    assignments: result.assignments,
    preAllocations: result.preAllocations,
    operationalCadastros: result.operationalCadastros,
    validation: result.validation,
  };
}

function handleManualEditError(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ManualEditBlockedError) {
    return reply.status(409).send({
      success: false,
      conflicts: err.conflicts,
      message: err.message,
      code: err.code,
    });
  }
  if (err instanceof ScheduleMonthNotFoundError) {
    return reply.status(404).send({ error: err.message, code: err.code });
  }
  if (err instanceof SchedulePublishedCannotEditError) {
    return reply.status(409).send({ error: err.message, code: err.code });
  }
  req.log.error(err);
  return reply.status(500).send({ error: "Erro na edição manual da escala" });
}

export async function manualEditCellController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = manualCellBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await manualScheduleEditUseCase.editCell(req.params.id, parsed.data);
    return reply.send(mapManualEditResult(result));
  } catch (err) {
    return handleManualEditError(err, req, reply);
  }
}

export async function manualEditRangeController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = manualRangeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await manualScheduleEditUseCase.editRange(req.params.id, parsed.data);
    return reply.send(mapManualEditResult(result));
  } catch (err) {
    return handleManualEditError(err, req, reply);
  }
}

export async function manualEditMoveController(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = manualMoveBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
  }
  try {
    const result = await manualScheduleEditUseCase.moveCell(req.params.id, parsed.data);
    return reply.send(mapManualEditResult(result));
  } catch (err) {
    return handleManualEditError(err, req, reply);
  }
}
