import { z } from "zod";

export const createRequestedDayOffSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional().default("PENDING"),
  notes: z.string().max(500).optional(),
});

export type CreateRequestedDayOffBody = z.infer<typeof createRequestedDayOffSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createRequestedDayOffBatchSchema = z.object({
  employeeId: z.string().uuid(),
  dates: z.array(dateStr).min(1, "Informe ao menos uma data"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  notes: z.string().max(500).optional(),
});

export type CreateRequestedDayOffBatchBody = z.infer<typeof createRequestedDayOffBatchSchema>;

export const updateRequestedDayOffSchema = z.object({
  employeeId: z.string().uuid().optional(),
  date: dateStr.optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type UpdateRequestedDayOffBody = z.infer<typeof updateRequestedDayOffSchema>;
