import type { BatchCreateResult, BatchDeleteResult } from '../models/api.models';

export function batchResultDetail(res: BatchCreateResult, entityLabel: string): string {
  return `${res.created} ${entityLabel}(s) cadastrado(s). ${res.skipped} duplicado(s) ignorado(s).`;
}

export function batchResultSeverity(res: BatchCreateResult): 'success' | 'warn' {
  return res.created > 0 ? 'success' : 'warn';
}

export function batchDeleteDetail(res: BatchDeleteResult, entityLabel: string): string {
  if (res.failed.length === 0) {
    return `${res.deleted} ${entityLabel}(s) excluído(s).`;
  }
  const failedIds = res.failed.map((f) => f.id).join(', ');
  return `${res.deleted} ${entityLabel}(s) excluído(s). ${res.failed.length} falha(s): ${failedIds}.`;
}
