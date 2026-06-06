/**
 * Canais WebSocket (Fase futura — não implementado).
 *
 * Admin: geração de escala, alertas de inconsistência, progresso do motor.
 * Cliente: atualização da grade em tempo real.
 */
export const WS_CHANNELS = {
  ADMIN: process.env.WS_PATH_ADMIN ?? "/ws/admin",
  CLIENT: process.env.WS_PATH_CLIENT ?? "/ws/client",
} as const;

export type WsEventType =
  | "schedule.generation.started"
  | "schedule.generation.progress"
  | "schedule.generation.completed"
  | "schedule.cell.updated"
  | "schedule.validation.alert";

export interface WsEnvelope<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: string;
}
