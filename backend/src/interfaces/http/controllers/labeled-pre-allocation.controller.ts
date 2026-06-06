import type { FastifyReply, FastifyRequest } from "fastify";
import { preAllocationUseCase } from "../../../application/use-cases/pre-allocation.use-case.js";
import { createBatchDeleteHandler } from "./batch-delete.controller.js";
import {
  labeledPreAllocationBatchSchema,
  updatePreAllocationSchema,
} from "../dto/pre-allocation.dto.js";

export type FixedOperationalLabel = "SIMULADOR" | "CURSO" | "CMA" | "OUTRO";

export function createLabeledPreAllocationHandlers(fixedLabel: FixedOperationalLabel) {
  return {
    async list(
      req: FastifyRequest<{ Querystring: { year?: string; month?: string } }>,
      reply: FastifyReply,
    ) {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const month = req.query.month ? Number(req.query.month) : undefined;
      const data = await preAllocationUseCase.list({
        year: Number.isInteger(year) ? year : undefined,
        month: Number.isInteger(month) && month! >= 1 && month! <= 12 ? month : undefined,
        label: fixedLabel,
      });
      return reply.send(data);
    },

    async createBatch(req: FastifyRequest, reply: FastifyReply) {
      const parsed = labeledPreAllocationBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
      }
      try {
        const result = await preAllocationUseCase.createBatch({
          ...parsed.data,
          label: fixedLabel,
        });
        return reply.status(201).send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao criar cadastro operacional";
        return reply.status(400).send({ error: msg });
      }
    },

    async update(
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const parsed = updatePreAllocationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
      }
      try {
        const updated = await preAllocationUseCase.update(
          req.params.id,
          parsed.data,
          fixedLabel,
        );
        return reply.send(updated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao atualizar cadastro";
        return reply.status(404).send({ error: msg });
      }
    },

    async remove(
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      try {
        await preAllocationUseCase.remove(req.params.id, fixedLabel);
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Cadastro operacional não encontrado" });
      }
    },

    removeBatch: createBatchDeleteHandler((ids) =>
      preAllocationUseCase.removeBatch(ids, fixedLabel),
    ),
  };
}

export const simulatorHandlers = createLabeledPreAllocationHandlers("SIMULADOR");
export const courseHandlers = createLabeledPreAllocationHandlers("CURSO");
export const cmaHandlers = createLabeledPreAllocationHandlers("CMA");
export const otherOperationalHandlers = createLabeledPreAllocationHandlers("OUTRO");
