export type ScheduleEngineVersion = "V4" | "V5" | "V6";

const VALID: ScheduleEngineVersion[] = ["V4", "V5", "V6"];

/** Versão do motor de geração — env SCHEDULE_ENGINE_VERSION (V4|V5|V6). Padrão: V6. */
export function resolveScheduleEngineVersion(
  env: NodeJS.ProcessEnv = process.env,
): ScheduleEngineVersion {
  const raw = (env.SCHEDULE_ENGINE_VERSION ?? "V6").trim().toUpperCase();
  if (raw === "V4" || raw === "REAL_V4") return "V4";
  if (raw === "V5" || raw === "REAL_V5") return "V5";
  if (raw === "V6" || raw === "REAL_V6") return "V6";
  return VALID.includes(raw as ScheduleEngineVersion) ? (raw as ScheduleEngineVersion) : "V6";
}

export function scheduleEngineFallbackToV4Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.SCHEDULE_ENGINE_FALLBACK_V4 ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}
