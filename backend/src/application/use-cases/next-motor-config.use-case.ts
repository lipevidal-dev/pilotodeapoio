import {
  NEXT_MOTOR_CATEGORY_LABELS,
  NEXT_MOTOR_RULES_CATALOG,
  buildNextMotorRulesView,
  type NextMotorRuleCategory,
} from "../../domain/schedule/next-motor/next-motor-rules-catalog.js";
import { buildNextMotorParamsView } from "../../domain/schedule/next-motor/next-motor-config-values.js";
import { buildPaoShiftParamsView, listPaoRateioShiftCodesFromShifts } from "../../domain/schedule/next-motor/next-motor-shift-params.js";
import { resolveAllowedShiftCodes } from "../../domain/schedule/next-motor/next-motor-allowed-shifts.js";
import { NextMotorConfigRepository } from "../../infrastructure/repositories/next-motor-config.repository.js";
import { ShiftRepository } from "../../infrastructure/repositories/shift.repository.js";

async function buildConfigResponse(
  cfg: Awaited<ReturnType<NextMotorConfigRepository["getFullConfig"]>>,
  shifts: Awaited<ReturnType<ShiftRepository["findAll"]>>,
) {
  const rules = buildNextMotorRulesView(cfg.enabled);
  const params = buildNextMotorParamsView(cfg.params);
  const rulesCatalog = NEXT_MOTOR_RULES_CATALOG.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    locked: r.locked,
    defaultEnabled: r.defaultEnabled,
  }));
  const paoShiftParams = buildPaoShiftParamsView(cfg.params, shifts, cfg.enabled, rulesCatalog);
  const rateioCodes = listPaoRateioShiftCodesFromShifts(shifts);
  const allowedShiftCodes = resolveAllowedShiftCodes(cfg.allowedShiftCodes, rateioCodes);
  const enabledCount = rules.filter((r) => r.enabled).length;
  const scopeCount = cfg.scopeEmployeeIds?.length ?? null;
  return {
    motorId: "NEXT" as const,
    motorLabel: "Motor automático",
    ready: true,
    enabledCount,
    totalCount: rules.length,
    scopeEmployeeIds: cfg.scopeEmployeeIds,
    scopeMode: cfg.scopeEmployeeIds === null ? ("all" as const) : ("selected" as const),
    scopeSelectedCount: scopeCount,
    employeePrefs: cfg.employeePrefs ?? {},
    allowedShiftCodes,
    categories: Object.entries(NEXT_MOTOR_CATEGORY_LABELS).map(([id, label]) => ({
      id: id as NextMotorRuleCategory,
      label,
    })),
    rules,
    params,
    paoShiftParams,
  };
}

export class NextMotorConfigUseCase {
  constructor(
    private readonly repo = new NextMotorConfigRepository(),
    private readonly shiftRepo = new ShiftRepository(),
  ) {}

  async getConfig() {
    const cfg = await this.repo.getFullConfig();
    const shifts = await this.shiftRepo.findAll(true);
    return buildConfigResponse(cfg, shifts);
  }

  async updateConfig(body: {
    enabled?: Record<string, boolean>;
    params?: Record<string, number>;
    scopeEmployeeIds?: string[] | null;
    employeePrefs?: Record<string, { preferredShiftId: string | null; restrictedShiftIds: string[] }>;
    allowedShiftCodes?: string[] | null;
  }) {
    const cfg = await this.repo.updateConfig(body);
    const shifts = await this.shiftRepo.findAll(true);
    return buildConfigResponse(cfg, shifts);
  }

  /** @deprecated Use updateConfig */
  async updateRules(enabled: Record<string, boolean>) {
    return this.updateConfig({ enabled });
  }
}

export const nextMotorConfigUseCase = new NextMotorConfigUseCase();
