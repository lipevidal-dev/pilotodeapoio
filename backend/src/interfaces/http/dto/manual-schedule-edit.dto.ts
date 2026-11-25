import { z } from "zod";

const dateSchema = z
  .string()
  .transform((value) => String(value ?? "").trim().slice(0, 10))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const employeeIdSchema = z.string().uuid();

function coerceManualAllocationType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const n = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  if (n === "FF" || n === "FOLGA FERIADO" || n === "FOLGAFERIADO" || n.includes("FERIADO")) {
    return "FF";
  }
  if (n === "F4" || n === "FOLGA 4" || n === "FOLGA4") return "F4";
  return n;
}

export const manualAllocationTypeSchema = z.preprocess(
  coerceManualAllocationType,
  z.enum([
  "T1",
  "T2",
  "T3",
  "T4",
  "T6",
  "T7",
  "T8",
  "T9",
  "ADM",
  "T8_BLOCK",
  "ND",
  "FOLGA",
  "F4",
  "FF",
  "FS",
  "FP",
  "VOO",
  "CURSO",
  "SIMULADOR",
  "CMA",
  "OUTRO",
  "CLEAR",
  ]),
);

const modeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["set", "clear"]),
);

export const manualCellBodySchema = z.object({
  employeeId: employeeIdSchema,
  date: dateSchema,
  type: manualAllocationTypeSchema,
  mode: modeSchema,
  force: z.boolean().optional(),
});

export const manualRangeBodySchema = z.object({
  employeeId: employeeIdSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  type: manualAllocationTypeSchema,
  mode: modeSchema,
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
