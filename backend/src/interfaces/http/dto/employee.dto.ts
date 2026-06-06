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

  })

  .refine((d) => Boolean(d.roleId || d.type), {

    message: "Informe roleId ou type",

    path: ["roleId"],

  });



export const updateEmployeeSchema = z.object({

  name: z.string().min(1).max(200).optional(),

  roleId: z.string().uuid().optional(),

  type: employeeTypeEnum.optional(),

  birthDate: birthDateField,

  seniorityNumber: z.number().int().positive().optional().nullable(),

  active: z.boolean().optional(),

  noFlightDates: isoDateArray.optional(),

  restrictedShiftIds: shiftIdArray.optional(),

});



export type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;

export type UpdateEmployeeBody = z.infer<typeof updateEmployeeSchema>;


