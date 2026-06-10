import { z } from "zod";



const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;



export const shiftCoverageTypeSchema = z.enum(["REQUIRED", "PARALLEL"]);



export const createShiftSchema = z.object({

  code: z.string().min(1).max(16).transform((s) => s.trim().toUpperCase()),

  name: z.string().min(1).max(120),

  startTime: z.string().regex(timeRegex, "Formato HH:MM"),

  endTime: z.string().regex(timeRegex, "Formato HH:MM"),

  roleType: z.enum(["PAO", "APAO", "BOTH"]),

  active: z.boolean().optional().default(true),

  displayOrder: z.number().int().min(0).optional().default(0),

  mandatoryCoverage: z.boolean().optional().default(false),

  requiresT8PairNd: z.boolean().optional().default(false),

  coverageType: shiftCoverageTypeSchema.optional().default("REQUIRED"),

});



export const updateShiftSchema = z.object({

  code: z.string().min(1).max(16).transform((s) => s.trim().toUpperCase()).optional(),

  name: z.string().min(1).max(120).optional(),

  startTime: z.string().regex(timeRegex, "Formato HH:MM").optional(),

  endTime: z.string().regex(timeRegex, "Formato HH:MM").optional(),

  roleType: z.enum(["PAO", "APAO", "BOTH"]).optional(),

  active: z.boolean().optional(),

  displayOrder: z.number().int().min(0).optional(),

  mandatoryCoverage: z.boolean().optional(),

  requiresT8PairNd: z.boolean().optional(),

  coverageType: shiftCoverageTypeSchema.optional(),

});

