import { z } from "zod";

export const createFlightAssignmentSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(500).optional(),
  source: z.enum(["MANUAL", "GENERATOR", "IMPORT", "REPAIR"]).optional(),
});

export type CreateFlightAssignmentBody = z.infer<typeof createFlightAssignmentSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createFlightAssignmentBatchSchema = z.object({
  employeeId: z.string().uuid(),
  dates: z.array(dateStr).min(1, "Informe ao menos uma data"),
  description: z.string().max(500).optional(),
  source: z.enum(["MANUAL", "GENERATOR", "IMPORT", "REPAIR"]).optional(),
});

export type CreateFlightAssignmentBatchBody = z.infer<typeof createFlightAssignmentBatchSchema>;

export const updateFlightAssignmentSchema = z.object({
  employeeId: z.string().uuid().optional(),
  date: dateStr.optional(),
  description: z.string().max(500).nullable().optional(),
});

export type UpdateFlightAssignmentBody = z.infer<typeof updateFlightAssignmentSchema>;
