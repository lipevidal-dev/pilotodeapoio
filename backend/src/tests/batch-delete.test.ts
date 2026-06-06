import { describe, expect, it } from "vitest";
import { executeBatchDelete } from "../application/use-cases/batch-delete.js";

describe("executeBatchDelete", () => {
  it("remove múltiplos ids com sucesso", async () => {
    const removed: string[] = [];
    const result = await executeBatchDelete(["a", "b", "c"], async (id) => {
      removed.push(id);
    });
    expect(result.deleted).toBe(3);
    expect(result.failed).toEqual([]);
    expect(removed).toEqual(["a", "b", "c"]);
  });

  it("reporta falhas parciais", async () => {
    const result = await executeBatchDelete(["ok", "bad", "ok2"], async (id) => {
      if (id === "bad") throw new Error("não encontrado");
    });
    expect(result.deleted).toBe(2);
    expect(result.failed).toEqual([{ id: "bad", error: "não encontrado" }]);
  });
});
