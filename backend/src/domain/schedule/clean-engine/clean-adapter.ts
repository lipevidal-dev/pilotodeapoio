import type { GenerationInput, GenerationResult } from "../generation-types.js";
import { generateCleanSchedule } from "./clean-engine.js";
import type { CleanEngineOptions } from "./clean-types.js";

/** Adaptador único — expõe a mesma interface consumida pelo use-case. */
export function generateScheduleClean(
  input: GenerationInput,
  options: CleanEngineOptions = {},
): GenerationResult {
  return generateCleanSchedule(input, options);
}

export { generateCleanSchedule } from "./clean-engine.js";
export { validateCleanGenerationBeforeSave } from "./clean-validator.js";
