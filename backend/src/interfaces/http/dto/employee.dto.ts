import { z } from "zod";

const employeeTypeEnum = z.enum(["PAO", "APAO"]);
const birthDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "birthDate deve ser yyyy-mm-dd")
  .optional()
  .nullable();

export const createEmployeeSchema = z
  .object({
    name: z.string().min(1).max(200),
    roleId: z.string().uuid().optional(),
    type: employeeTypeEnum.optional(),
    birthDate: birthDateField,
    active: z.boolean().optional().default(true),
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
  active: z.boolean().optional(),
});

export type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeSchema>;
