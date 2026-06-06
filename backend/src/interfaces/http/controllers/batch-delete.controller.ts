import type { FastifyReply, FastifyRequest } from "fastify";
import { batchDeleteSchema } from "../dto/batch-delete.dto.js";

export function createBatchDeleteHandler(
  removeBatch: (ids: string[]) => Promise<{ deleted: number; failed: Array<{ id: string; error: string }> }>,
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Payload inválido", details: parsed.error.flatten() });
    }
    const result = await removeBatch(parsed.data.ids);
    return reply.send(result);
  };
}
