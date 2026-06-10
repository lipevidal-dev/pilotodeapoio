import type { HttpErrorResponse } from '@angular/common/http';

export interface ManualEditConflictPayload {
  code?: string;
  message?: string;
}

/** Extrai mensagem principal de conflito retornada pelo backend. */
export function extractManualEditConflictMessage(err: HttpErrorResponse): string {
  const body = err.error as
    | {
        message?: string;
        error?: string;
        conflicts?: ManualEditConflictPayload[];
      }
    | string
    | null
    | undefined;

  if (!body) {
    if (err.status === 0) {
      return 'Não foi possível contactar o servidor. Verifique a conexão e se o backend está ativo.';
    }
    return 'Não foi possível aplicar a alteração.';
  }

  if (typeof body === 'string') {
    return body;
  }

  const conflicts = body.conflicts;
  if (Array.isArray(conflicts) && conflicts.length > 0) {
    const primary = conflicts.find((c) => c.message?.trim()) ?? conflicts[0];
    if (primary?.message) {
      return primary.message;
    }
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message;
  }

  if (typeof body.error === 'string' && body.error.trim()) {
    return body.error;
  }

  return 'Não foi possível aplicar a alteração.';
}
