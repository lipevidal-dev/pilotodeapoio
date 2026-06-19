import type { GenerationInput, GenerationResult } from "./generation-types.js";
import type { CleanEngineOptions } from "./clean-engine/clean-types.js";
import { generateScheduleClean } from "./clean-engine/clean-adapter.js";
import { ENGINE_PATH_CLEAN, MOTOR_VERSION_CLEAN, MOTOR_VERSION_NEXT } from "./engine-metadata.js";

export function resolveActiveMotorVersion(): typeof MOTOR_VERSION_CLEAN | typeof MOTOR_VERSION_NEXT {
  return MOTOR_VERSION_NEXT;
}

export function resolveActiveEnginePath(): typeof ENGINE_PATH_CLEAN {
  return ENGINE_PATH_CLEAN;
}

/** Geração via CleanEngine + configuração do motor NEXT. */
export function generateScheduleWithRouter(
  input: GenerationInput,
  options?: CleanEngineOptions,
): GenerationResult {
  return generateScheduleClean(input, options);
}