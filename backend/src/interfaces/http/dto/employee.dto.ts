import { z } from "zod";
import { PORTAL_LOGIN_MAX, PORTAL_PASSWORD_MAX, PORTAL_PASSWORD_MIN } from "../../../domain/auth/portal-login.js";



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

const fcfScheduleEntrySchema = z.object({
  shiftId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
});

const fcfScheduleArray = z.array(fcfScheduleEntrySchema).optional().default([]);

const portalLoginField = z
  .string()
  .trim()
  .max(PORTAL_LOGIN_MAX, "Login deve ter no máximo 20 caracteres")
  .nullable()
  .optional()
  .superRefine((value, ctx) => {
    if (value == null || value === "") return;
    if (value.length < 3) {
      ctx.addIssue({ code: "custom", message: "Login deve ter ao menos 3 caracteres" });
    }
    if (!/^[a-zA-Z0-9._@-]+$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "Login contém caracteres inválidos" });
    }
  });

const portalPasswordField = z
  .string()
  .trim()
  .max(PORTAL_PASSWORD_MAX, "Senha deve ter no máximo 120 caracteres")
  .nullable()
  .optional()
  .superRefine((value, ctx) => {
    if (value == null || value === "") return;
    if (value.length < PORTAL_PASSWORD_MIN) {
      ctx.addIssue({ code: "custom", message: "Senha deve ter ao menos 6 caracteres" });
    }
  });

function refineFcfSchedule(
  data: { isFcf?: boolean; fcfSchedule?: Array<{ shiftId: string; weekday: number }> },
  ctx: z.RefinementCtx,
): void {
  const schedule = data.fcfSchedule ?? [];
  if (schedule.length === 0) return;
  const weekdays = schedule.map((r) => r.weekday);
  if (weekdays.length !== new Set(weekdays).size) {
    ctx.addIssue({
      code: "custom",
      message: "Cada dia da semana pode aparecer apenas uma vez na alocação FCF",
      path: ["fcfSchedule"],
    });
  }
}



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

    cif: z.string().trim().max(32).optional().nullable(),

    active: z.boolean().optional().default(true),

    noFlightDates: isoDateArray,

    restrictedShiftIds: shiftIdArray,

    preferredShiftIds: preferredShiftIdArray,

    specificShiftRequests: specificShiftRequestArray,

    isFcf: z.boolean().optional().default(false),

    fcfSchedule: fcfScheduleArray,

    inInstruction: z.boolean().optional().default(false),

    portalLogin: portalLoginField,

    portalPassword: portalPasswordField,

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

  .refine((d) => rejectRestrictedPreferredOverlap(d.restrictedShiftIds, d.preferredShiftIds))

  .superRefine((d, ctx) => refineFcfSchedule(d, ctx))

  .superRefine((d, ctx) => {
    const login = d.portalLogin?.trim();
    const password = d.portalPassword?.trim();
    if (login && !password) {
      ctx.addIssue({
        code: "custom",
        message: "Informe a senha para criar o acesso ao portal colaborador.",
        path: ["portalPassword"],
      });
    }
  });



export const updateEmployeeSchema = z

  .object({

    name: z.string().min(1).max(200).optional(),

    roleId: z.string().uuid().optional(),

    type: employeeTypeEnum.optional(),

    birthDate: birthDateField,

    seniorityNumber: z.number().int().positive().optional().nullable(),

    cif: z.string().trim().max(32).optional().nullable(),

    active: z.boolean().optional(),

    noFlightDates: isoDateArray.optional(),

    restrictedShiftIds: shiftIdArray.optional(),

    preferredShiftIds: preferredShiftIdArray.optional(),

    specificShiftRequests: specificShiftRequestArray.optional(),

    isFcf: z.boolean().optional(),

    fcfSchedule: fcfScheduleArray.optional(),

    inInstruction: z.boolean().optional(),

    portalLogin: portalLoginField,

    portalPassword: portalPasswordField,

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
    refineFcfSchedule(
      {
        isFcf: d.isFcf,
        fcfSchedule: d.fcfSchedule,
      },
      ctx,
    );
  });



export type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;

export type UpdateEmployeeBody = z.infer<typeof updateEmployeeSchema>;

