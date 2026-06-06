import { z } from "zod";

const validPreAllocLabel = z.enum(["SIMULADOR", "CURSO", "CMA", "OUTRO"]);

export const createPreAllocationSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: validPreAllocLabel,
  notes: z.string().optional(),
});

export type CreatePreAllocationBody = z.infer<typeof createPreAllocationSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createPreAllocationBatchSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employeeId: z.string().uuid(),
  dates: z.array(dateStr).min(1, "Informe ao menos uma data"),
  label: validPreAllocLabel,
  notes: z.string().optional(),
});

export type CreatePreAllocationBatchBody = z.infer<typeof createPreAllocationBatchSchema>;

export const labeledPreAllocationBatchSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employeeId: z.string().uuid(),
  dates: z.array(dateStr).min(1, "Informe ao menos uma data"),
  notes: z.string().optional(),
});

export type LabeledPreAllocationBatchBody = z.infer<typeof labeledPreAllocationBatchSchema>;

export const updatePreAllocationSchema = z.object({
  date: dateStr.optional(),
  notes: z.string().nullable().optional(),
  employeeId: z.string().uuid().optional(),
});

export type UpdatePreAllocationBody = z.infer<typeof updatePreAllocationSchema>;
