import { sanitizeEmployeeMotorPrefs } from "./next-motor-employee-prefs.js";
import { RATEIO_TURN_CODES } from "../clean-engine/clean-types.js";

/** Preferências de turno por funcionário — configuradas no Motor de Escala. */
export interface EmployeeMotorPrefStored {
  preferredShiftId: string | null;
  restrictedShiftIds: string[];
}

/** Formato persistido em system_config (key: next_motor_rules). */
export interface NextMotorStoredConfig {
  enabled: Record<string, boolean>;
  params: Record<string, number>;
  /** null = todos os funcionários ativos; array = somente os IDs listados. */
  scopeEmployeeIds: string[] | null;
  /** Preferências de turno por employeeId (sobrescrevem cadastro na geração). */
  employeePrefs?: Record<string, EmployeeMotorPrefStored>;
  /** Turnos rateio que o motor pode alocar; null = todos os turnos rateio ativos. */
  allowedShiftCodes?: string[] | null;
}

export function emptyNextMotorStoredConfig(): NextMotorStoredConfig {
  return { enabled: {}, params: {}, scopeEmployeeIds: null, employeePrefs: {}, allowedShiftCodes: null };
}

const LEGACY_RULE_ALIASES: Record<string, string[]> = {
  pao_20_turnos: ["pao_meta_turnos", "pao_meta_dias_trabalhados"],
  parallel_t9: ["coverage_t9"],
};

/** Converte valor legado (mapa plano de booleans) ou objeto completo. */
export function parseNextMotorStored(value: unknown): Partial<NextMotorStoredConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const obj = value as Record<string, unknown>;

  if ("enabled" in obj && typeof obj.enabled === "object" && obj.enabled && !Array.isArray(obj.enabled)) {
    const enabled = { ...(obj.enabled as Record<string, boolean>) };
    migrateLegacyEnabledKeys(enabled);
    const params =
      obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, number>)
        : {};
    let scopeEmployeeIds: string[] | null = null;
    if (obj.scopeEmployeeIds === null) {
      scopeEmployeeIds = null;
    } else if (Array.isArray(obj.scopeEmployeeIds)) {
      scopeEmployeeIds = obj.scopeEmployeeIds.filter((id): id is string => typeof id === "string");
    }
    const employeePrefs = sanitizeEmployeeMotorPrefs(obj.employeePrefs);
    let allowedShiftCodes: string[] | null = null;
    if (obj.allowedShiftCodes === null) {
      allowedShiftCodes = null;
    } else if (Array.isArray(obj.allowedShiftCodes)) {
      const rateio = new Set<string>(RATEIO_TURN_CODES);
      const codes = [
        ...new Set(
          obj.allowedShiftCodes
            .filter((c): c is string => typeof c === "string")
            .map((c) => c.trim().toUpperCase())
            .filter((c) => rateio.has(c)),
        ),
      ];
      allowedShiftCodes = codes.length > 0 ? codes : null;
    }
    return { enabled, params, scopeEmployeeIds, employeePrefs, allowedShiftCodes };
  }

  const enabled: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "boolean") enabled[key] = val;
  }
  migrateLegacyEnabledKeys(enabled);
  return { enabled };
}

function migrateLegacyEnabledKeys(enabled: Record<string, boolean>): void {
  for (const [legacyId, targets] of Object.entries(LEGACY_RULE_ALIASES)) {
    if (typeof enabled[legacyId] !== "boolean") continue;
    const val = enabled[legacyId];
    delete enabled[legacyId];
    for (const id of targets) {
      if (typeof enabled[id] !== "boolean") enabled[id] = val;
    }
  }
}

export function sanitizeScopeEmployeeIds(ids: string[] | null | undefined): string[] | null {
  if (ids === null || ids === undefined) return null;
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  return unique;
}
