import { z } from "zod";

export const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export type BatchDeletePayload = z.infer<typeof batchDeleteSchema>;
