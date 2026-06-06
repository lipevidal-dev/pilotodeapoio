import { z } from "zod";

const employeeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  role: z.enum(["PAO", "APAO", "PAO FCF"]),
  seniority: z.number().int().optional(),
  active: z.boolean().optional(),
  fixedShiftCode: z.string().nullable().optional(),
  isFixedShift: z.boolean().optional(),
});

const shiftSchema = z.object({
  code: z.string().min(1),
  role: z.enum(["PAO", "APAO", "PAO FCF"]),
  name: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  minStaff: z.number().int().optional(),
  maxStaff: z.number().int().optional(),
  noWeekends: z.boolean().optional(),
});

const assignmentSchema = z.object({
  employeeId: z.number().int().positive(),
  employeeName: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftCode: z.string().min(1),
});

const allocationSchema = z.object({
  employeeId: z.number().int().positive(),
  employeeName: z.string().min(1),
  allocDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allocType: z.string().min(1),
});

export const validateScheduleBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  employees: z.array(employeeSchema).min(1),
  shifts: z.array(shiftSchema).min(1),
  assignments: z.array(assignmentSchema),
  allocations: z.array(allocationSchema),
  shiftRestrictions: z.record(z.string(), z.array(z.string())).optional(),
  previousMonthAssignments: z.array(assignmentSchema).optional(),
});

export type ValidateScheduleBody = z.infer<typeof validateScheduleBodySchema>;

export const generateScheduleBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export type GenerateScheduleBody = z.infer<typeof generateScheduleBodySchema>;

const stepGenerationOptionsSchema = z.object({
  paoCheckPreAllocations: z.boolean(),
  paoCheckRestrictions: z.boolean(),
  paoDemandPlanning: z.boolean(),
  paoCoverageT6: z.boolean(),
  paoCoverageT7: z.boolean(),
  paoCoverageT8: z.boolean(),
  paoAllocateFolgas: z.boolean(),
  paoAllocateFlights: z.boolean(),
  apaoCheckPreAllocations: z.boolean(),
  apaoCheckShiftPreference: z.boolean(),
  apaoCheckShiftRestrictions: z.boolean(),
  apaoAllocate: z.boolean(),
});

export const generateScheduleByStepsBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  steps: stepGenerationOptionsSchema,
});

export type GenerateScheduleByStepsBody = z.infer<typeof generateScheduleByStepsBodySchema>;
