import type { GenerationInput, GenerationResult } from "./generation-types.js";
import { realScheduleEngineV4 } from "./real-schedule-engine-v4.js";
import { realScheduleEngineV5 } from "./real-schedule-engine-v5.js";
import { realScheduleEngineV6 } from "./real-schedule-engine-v6.js";
import {
  resolveScheduleEngineVersion,
  scheduleEngineFallbackToV4Enabled,
  type ScheduleEngineVersion,
} from "./schedule-engine-config.js";
import {
  MOTOR_VERSION_V4,
  MOTOR_VERSION_V5,
  MOTOR_VERSION_V6,
} from "./real-schedule-types.js";

export function resolveActiveMotorVersion(
  env: NodeJS.ProcessEnv = process.env,
): typeof MOTOR_VERSION_V4 | typeof MOTOR_VERSION_V5 | typeof MOTOR_VERSION_V6 {
  const version = resolveScheduleEngineVersion(env);
  if (version === "V4") return MOTOR_VERSION_V4;
  if (version === "V5") return MOTOR_VERSION_V5;
  return MOTOR_VERSION_V6;
}

/** Gera escala com V6 (padrão), V5 ou V4; fallback opcional para V4 em falha. */
export function generateScheduleWithRouter(
  input: GenerationInput,
  env: NodeJS.ProcessEnv = process.env,
): GenerationResult {
  const version: ScheduleEngineVersion = resolveScheduleEngineVersion(env);

  if (version === "V4") {
    return realScheduleEngineV4.generate(input);
  }

  if (version === "V5") {
    try {
      return realScheduleEngineV5.generate(input);
    } catch (err) {
      if (scheduleEngineFallbackToV4Enabled(env)) {
        return realScheduleEngineV4.generate(input);
      }
      throw err;
    }
  }

  try {
    return realScheduleEngineV6.generate(input);
  } catch (err) {
    if (scheduleEngineFallbackToV4Enabled(env)) {
      return realScheduleEngineV4.generate(input);
    }
    throw err;
  }
}
