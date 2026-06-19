/** Identificador único do motor de geração ativo. */
export const MOTOR_VERSION_CLEAN = "CLEAN" as const;

/** Motor automático configurável (Configurações → Motor de Escala). */
export const MOTOR_VERSION_NEXT = "NEXT" as const;

export const ENGINE_PATH_CLEAN = "domain/schedule/clean-engine/clean-engine.ts" as const;

export type CleanMotorVersion = typeof MOTOR_VERSION_CLEAN;
export type NextMotorVersion = typeof MOTOR_VERSION_NEXT;
export type CleanEnginePath = typeof ENGINE_PATH_CLEAN;
