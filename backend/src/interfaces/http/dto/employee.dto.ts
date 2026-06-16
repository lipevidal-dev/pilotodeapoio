import { z } from "zod";



const employeeTypeEnum = z.enum(["PAO", "APAO"]);

const birthDateField = z

  .string()

  .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate deve ser yyyy-mm-dd")

  .optional()

  .nullable();



const isoDateArray = z

  .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))

  .optional()

  .default([]);



const shiftIdArray = z.array(z.string().uuid()).optional().default([]);

const preferredShiftIdArray = z.array(z.string().uuid()).optional().default([]);

const specificShiftRequestSchema = z
  .object({
    shiftId: z.string().uuid(),
    year: z.number().int().min(2000).max(2100).optional().nullable(),
    month: z.number().int().min(1).max(12).optional().nullable(),
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    weekday: z.number().int().min(0).max(6).optional().nullable(),
  })
  .superRefine((row, ctx) => {
    const hasDay = row.dayOfMonth != null;
    const hasWeekday = row.weekday != null;
    if (hasDay === hasWeekday) {
      ctx.addIssue({
        code: "custom",
        message: "Informe dayOfMonth ou weekday (exclusivo)",
        path: ["dayOfMonth"],
      });
    }
  });

const specificShiftRequestArray = z.array(specificShiftRequestSchema).optional().default([]);



function rejectDuplicateShiftIds(ids: string[], path: string) {
  return ids.length === new Set(ids).size
    ? true
    : { message: "IDs de turno duplicados", path: [path] };
}

function rejectRestrictedPreferredOverlap(
  restrictedShiftIds: string[],
  preferredShiftIds: string[],
) {
  const restricted = new Set(restrictedShiftIds);
  const overlap = preferredShiftIds.some((id) => restricted.has(id));
  return overlap
    ? {
        message: "Turno não pode estar em restrição e preferência ao mesmo tempo",
        path: ["preferredShiftIds"],
      }
    : true;
}



export const createEmployeeSchema = z

  .object({

    name: z.string().min(1).max(200),

    roleId: z.string().uuid().optional(),

    type: employeeTypeEnum.optional(),

    birthDate: birthDateField,

    seniorityNumber: z.number().int().positive().optional(),

    active: z.boolean().optional().default(true),

    noFlightDates: isoDateArray,

    restrictedShiftIds: shiftIdArray,

    preferredShiftIds: preferredShiftIdArray,

    specificShiftRequests: specificShiftRequestArray,

  })

  .refine((d) => Boolean(d.roleId || d.type), {

    message: "Informe roleId ou type",

    path: ["roleId"],

  })

  .refine((d) => rejectDuplicateShiftIds(d.restrictedShiftIds, "restrictedShiftIds"), {

    message: "IDs de turno duplicados",

    path: ["restrictedShiftIds"],

  })

  .refine((d) => rejectDuplicateShiftIds(d.preferredShiftIds, "preferredShiftIds"), {

    message: "IDs de turno duplicados",

    path: ["preferredShiftIds"],

  })

  .refine((d) => rejectRestrictedPreferredOverlap(d.restrictedShiftIds, d.preferredShiftIds));



export const updateEmployeeSchema = z

  .object({

    name: z.string().min(1).max(200).optional(),

    roleId: z.string().uuid().optional(),

    type: employeeTypeEnum.optional(),

    birthDate: birthDateField,

    seniorityNumber: z.number().int().positive().optional().nullable(),

    active: z.boolean().optional(),

    noFlightDates: isoDateArray.optional(),

    restrictedShiftIds: shiftIdArray.optional(),

    preferredShiftIds: preferredShiftIdArray.optional(),

    specificShiftRequests: specificShiftRequestArray.optional(),

  })

  .superRefine((d, ctx) => {
    if (d.restrictedShiftIds && !rejectDuplicateShiftIds(d.restrictedShiftIds, "restrictedShiftIds")) {
      ctx.addIssue({
        code: "custom",
        message: "IDs de turno duplicados",
        path: ["restrictedShiftIds"],
      });
    }
    if (d.preferredShiftIds && !rejectDuplicateShiftIds(d.preferredShiftIds, "preferredShiftIds")) {
      ctx.addIssue({
        code: "custom",
        message: "IDs de turno duplicados",
        path: ["preferredShiftIds"],
      });
    }
    if (d.restrictedShiftIds && d.preferredShiftIds) {
      const overlap = rejectRestrictedPreferredOverlap(d.restrictedShiftIds, d.preferredShiftIds);
      if (overlap !== true) {
        ctx.addIssue({ code: "custom", message: overlap.message, path: ["preferredShiftIds"] });
      }
    }
  });



export type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;

export type UpdateEmployeeBody = z.infer<typeof updateEmployeeSchema>;

