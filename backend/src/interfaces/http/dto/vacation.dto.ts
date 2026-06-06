import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createVacationSchema = z.object({
  employeeId: z.string().uuid(),
  startDate: dateStr,
  endDate: dateStr,
  notes: z.string().max(500).optional(),
});

export type CreateVacationBody = z.infer<typeof createVacationSchema>;

const periodSchema = z
  .object({
    startDate: dateStr,
    endDate: dateStr,
  })
  .refine((p) => p.startDate <= p.endDate, {
    message: "startDate deve ser anterior ou igual a endDate",
  });

export const createVacationBatchSchema = z.object({
  employeeId: z.string().uuid(),
  periods: z.array(periodSchema).min(1, "Informe ao menos um período"),
  notes: z.string().max(500).optional(),
});

export type CreateVacationBatchBody = z.infer<typeof createVacationBatchSchema>;
