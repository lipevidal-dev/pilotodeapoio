import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(32).regex(/^[A-Za-z0-9_]+$/),
  description: z.string().max(500).optional().nullable(),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0).optional().default(0),
});

export const updateRoleSchema = createRoleSchema.partial();

export type CreateRoleBody = z.infer<typeof createRoleSchema>;
export type UpdateRoleBody = z.infer<typeof updateRoleSchema>;
