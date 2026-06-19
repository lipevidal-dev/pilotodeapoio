/** Configuração do motor — único caminho: CleanEngine. */
export const SCHEDULE_ENGINE_ID = "CLEAN" as const;

export type ScheduleEngineId = typeof SCHEDULE_ENGINE_ID;

/** Mantido por compatibilidade de env — qualquer valor resolve para CLEAN. */
export function resolveScheduleEngineVersion(
  _env: NodeJS.ProcessEnv = process.env,
): ScheduleEngineId {
  return SCHEDULE_ENGINE_ID;
}

/** Fallback desabilitado — não há motor alternativo. */
export function scheduleEngineFallbackEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return false;
}
