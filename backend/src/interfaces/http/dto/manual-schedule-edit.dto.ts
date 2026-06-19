import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const employeeIdSchema = z.string().uuid();

export const manualAllocationTypeSchema = z.enum([
  "T1",
  "T2",
  "T3",
  "T4",
  "T6",
  "T7",
  "T8",
  "T9",
  "T8_BLOCK",
  "ND",
  "FOLGA",
  "FS",
  "FP",
  "VOO",
  "CURSO",
  "SIMULADOR",
  "CMA",
  "OUTRO",
  "CLEAR",
]);

export const manualCellBodySchema = z.object({
  employeeId: employeeIdSchema,
  date: dateSchema,
  type: manualAllocationTypeSchema,
  mode: z.enum(["set", "clear"]),
  force: z.boolean().optional(),
});

export const manualRangeBodySchema = z.object({
  employeeId: employeeIdSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  type: manualAllocationTypeSchema,
  mode: z.enum(["set", "clear"]),
  force: z.boolean().optional(),
});

export const manualMoveBodySchema = z.object({
  source: z.object({
    employeeId: employeeIdSchema,
    date: dateSchema,
  }),
  target: z.object({
    employeeId: employeeIdSchema,
    date: dateSchema,
  }),
  mode: z.literal("move"),
  force: z.boolean().optional(),
});
