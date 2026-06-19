import { z } from "zod";

import { NEXT_MOTOR_RULES_CATALOG } from "../../../domain/schedule/next-motor/next-motor-rules-catalog.js";

import { NEXT_MOTOR_NUMERIC_PARAMS } from "../../../domain/schedule/next-motor/next-motor-config-values.js";

import {

  isPaoShiftParamId,

  isPaoShiftRuleEnabledId,

} from "../../../domain/schedule/next-motor/next-motor-shift-params.js";



const employeeMotorPrefSchema = z.object({

  preferredShiftId: z.string().min(1).nullable(),

  restrictedShiftIds: z.array(z.string().min(1)),

});



const allowedRuleIds = new Set(NEXT_MOTOR_RULES_CATALOG.map((r) => r.id));

const allowedParamIds = new Set(NEXT_MOTOR_NUMERIC_PARAMS.map((p) => p.id));



function isAllowedRuleKey(key: string): boolean {

  return allowedRuleIds.has(key) || isPaoShiftRuleEnabledId(key);

}



function isAllowedParamKey(key: string): boolean {

  return allowedParamIds.has(key) || isPaoShiftParamId(key);

}



export const updateNextMotorConfigSchema = z.object({

  enabled: z

    .record(z.string(), z.boolean())

    .optional()

    .superRefine((val, ctx) => {

      if (!val) return;

      for (const key of Object.keys(val)) {

        if (!isAllowedRuleKey(key)) {

          ctx.addIssue({

            code: "custom",

            message: `Regra desconhecida: ${key}`,

            path: [key],

          });

        }

      }

    }),

  params: z

    .record(z.string(), z.number())

    .optional()

    .superRefine((val, ctx) => {

      if (!val) return;

      for (const key of Object.keys(val)) {

        if (!isAllowedParamKey(key)) {

          ctx.addIssue({

            code: "custom",

            message: `Parâmetro desconhecido: ${key}`,

            path: [key],

          });

        }

      }

    }),

  scopeEmployeeIds: z.array(z.string().min(1)).nullable().optional(),

  employeePrefs: z.record(z.string().min(1), employeeMotorPrefSchema).optional(),

  allowedShiftCodes: z.array(z.string().min(1)).nullable().optional(),

});



export type UpdateNextMotorConfigBody = z.infer<typeof updateNextMotorConfigSchema>;



/** @deprecated */

export const updateNextMotorRulesSchema = updateNextMotorConfigSchema;

export type UpdateNextMotorRulesBody = UpdateNextMotorConfigBody;


