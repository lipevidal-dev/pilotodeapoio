import { prisma } from "../database/prisma-client.js";
import type { Prisma } from "@prisma/client";
import {
  NEXT_MOTOR_CONFIG_KEY,
  mergeNextMotorEnabled,
  sanitizeNextMotorPatch,
} from "../../domain/schedule/next-motor/next-motor-rules-catalog.js";
import {
  mergeNextMotorParams,
  sanitizeNextMotorParamsPatch,
} from "../../domain/schedule/next-motor/next-motor-config-values.js";
import { listPaoRateioShiftCodesFromShifts } from "../../domain/schedule/next-motor/next-motor-shift-params.js";
import {
  parseNextMotorStored,
  sanitizeScopeEmployeeIds,
  type EmployeeMotorPrefStored,
  type NextMotorStoredConfig,
} from "../../domain/schedule/next-motor/next-motor-stored-config.js";
import { sanitizeAllowedShiftCodes } from "../../domain/schedule/next-motor/next-motor-allowed-shifts.js";
import { sanitizeEmployeeMotorPrefs } from "../../domain/schedule/next-motor/next-motor-employee-prefs.js";
import { ShiftRepository } from "./shift.repository.js";

export class NextMotorConfigRepository {
  constructor(private readonly shiftRepo = new ShiftRepository()) {}

  private async listRateioShiftCodes(): Promise<string[]> {
    const shifts = await this.shiftRepo.findAll(true);
    return listPaoRateioShiftCodesFromShifts(shifts);
  }

  async getFullConfig(): Promise<NextMotorStoredConfig> {
    const row = await prisma.systemConfig.findUnique({
      where: { key: NEXT_MOTOR_CONFIG_KEY },
    });
    const parsed = parseNextMotorStored(row?.value);
    const shiftCodes = await this.listRateioShiftCodes();
    return {
      enabled: mergeNextMotorEnabled(parsed.enabled),
      params: mergeNextMotorParams(parsed.params, shiftCodes),
      scopeEmployeeIds: sanitizeScopeEmployeeIds(parsed.scopeEmployeeIds),
      employeePrefs: sanitizeEmployeeMotorPrefs(parsed.employeePrefs),
      allowedShiftCodes: sanitizeAllowedShiftCodes(parsed.allowedShiftCodes, shiftCodes),
    };
  }

  async getEnabledMap(): Promise<Record<string, boolean>> {
    const cfg = await this.getFullConfig();
    return cfg.enabled;
  }

  async updateConfig(patch: {
    enabled?: Record<string, boolean>;
    params?: Record<string, number>;
    scopeEmployeeIds?: string[] | null;
    employeePrefs?: Record<string, EmployeeMotorPrefStored>;
    allowedShiftCodes?: string[] | null;
  }): Promise<NextMotorStoredConfig> {
    const current = await this.getFullConfig();
    const shiftCodes = await this.listRateioShiftCodes();
    const enabledPatch = patch.enabled ? sanitizeNextMotorPatch(patch.enabled) : {};
    const paramsPatch = patch.params ? sanitizeNextMotorParamsPatch(patch.params, shiftCodes) : {};
    const final: NextMotorStoredConfig = {
      enabled: mergeNextMotorEnabled({ ...current.enabled, ...enabledPatch }),
      params: mergeNextMotorParams({ ...current.params, ...paramsPatch }, shiftCodes),
      scopeEmployeeIds:
        patch.scopeEmployeeIds !== undefined
          ? sanitizeScopeEmployeeIds(patch.scopeEmployeeIds)
          : current.scopeEmployeeIds,
      employeePrefs:
        patch.employeePrefs !== undefined
          ? sanitizeEmployeeMotorPrefs(patch.employeePrefs)
          : current.employeePrefs ?? {},
      allowedShiftCodes:
        patch.allowedShiftCodes !== undefined
          ? sanitizeAllowedShiftCodes(patch.allowedShiftCodes, shiftCodes)
          : current.allowedShiftCodes ?? null,
    };

    const jsonValue = final as unknown as Prisma.InputJsonValue;

    await prisma.systemConfig.upsert({
      where: { key: NEXT_MOTOR_CONFIG_KEY },
      create: { key: NEXT_MOTOR_CONFIG_KEY, value: jsonValue },
      update: { value: jsonValue },
    });

    return final;
  }

  /** @deprecated Use updateConfig */
  async updateEnabled(patch: Record<string, boolean>): Promise<Record<string, boolean>> {
    const final = await this.updateConfig({ enabled: patch });
    return final.enabled;
  }
}
