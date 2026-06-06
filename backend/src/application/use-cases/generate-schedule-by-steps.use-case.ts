import { scheduleGenerationInputService } from "../services/schedule-generation-input.service.js";
import { stepGenerationEngine } from "../../domain/schedule/step-generation-engine.js";
import type { StepGenerationOptions } from "../../domain/schedule/step-generation-types.js";

export class GenerateScheduleByStepsUseCase {
  async execute(year: number, month: number, steps: StepGenerationOptions) {
    const input = await scheduleGenerationInputService.loadForMonth(year, month);
    const result = stepGenerationEngine.execute(input, steps);
    return stepGenerationEngine.toApiResponse(result);
  }
}

export const generateScheduleByStepsUseCase = new GenerateScheduleByStepsUseCase();
