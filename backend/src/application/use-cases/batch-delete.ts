export interface BatchDeleteResult {
  deleted: number;
  failed: Array<{ id: string; error: string }>;
}

export async function executeBatchDelete(
  ids: string[],
  removeOne: (id: string) => Promise<void>,
): Promise<BatchDeleteResult> {
  const uniqueIds = [...new Set(ids)];
  const failed: Array<{ id: string; error: string }> = [];
  let deleted = 0;

  for (const id of uniqueIds) {
    try {
      await removeOne(id);
      deleted++;
    } catch (err) {
      failed.push({
        id,
        error: err instanceof Error ? err.message : "Erro ao excluir",
      });
    }
  }

  return { deleted, failed };
}
