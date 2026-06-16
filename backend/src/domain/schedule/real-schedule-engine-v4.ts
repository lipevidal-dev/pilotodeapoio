import { RealScheduleEngine } from "./real-schedule-engine.js";
import type { GenerationInput, GenerationResult } from "./generation-types.js";
import {
  ENGINE_PATH_V4,
  MOTOR_VERSION_V4,
} from "./real-schedule-types.js";

/**
 * Backup do motor V4 (pipeline completo com reparos/enforce).
 * Implementação = RealScheduleEngine atual, versionado como REAL_V4.
 */
export class RealScheduleEngineV4 extends RealScheduleEngine {
  override generate(input: GenerationInput): GenerationResult {
    const result = super.generate(input);
    return {
      ...result,
      summary: {
        ...result.summary,
        motorVersion: MOTOR_VERSION_V4,
        enginePath: ENGINE_PATH_V4,
        realEngineExecuted: true,
      },
    };
  }
}

export const realScheduleEngineV4 = new RealScheduleEngineV4();
