import { describe, expect, it } from "vitest";
import {
  auditV3PipelineTurnBalance,
  formatTurnBalanceChain,
  formatV3PipelineTurnBalanceTable,
  prepareWorkspaceForV3PipelineAudit,
} from "../domain/schedule/v3-pipeline-turn-balance.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

describe("v3-pipeline-turn-balance", () => {
  it("gera saldo por etapa para todos os PAOs", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const ws = prepareWorkspaceForV3PipelineAudit(input);
    const report = auditV3PipelineTurnBalance(ws);

    expect(report.employees.length).toBe(input.employees.filter((e) => e.employee.role === "PAO").length);
    for (const row of report.employees) {
      expect(row.turnTarget).toBeGreaterThanOrEqual(0);
      expect(row.plannedTurns).toBeGreaterThanOrEqual(0);
      expect(row.turnsAfterMaterialization).toBeGreaterThanOrEqual(row.turnsBeforeMaterialization);
      expect(row.turnsAfterCoverageRepair).toBeGreaterThanOrEqual(row.turnsAfterMaterialization);
      expect(formatTurnBalanceChain(row)).toMatch(/\d+ → \d+/);
    }
  });

  it("imprime tabela comparativa sem erro", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const ws = prepareWorkspaceForV3PipelineAudit(input);
    const report = auditV3PipelineTurnBalance(ws);
    const table = formatV3PipelineTurnBalanceTable(report);

    expect(table).toContain("V3 TURN BALANCE BY STAGE");
    expect(table).toContain("Cadeia:");
    expect(table.split("\n").length).toBeGreaterThan(5);
  });

  it("identifica etapa de perda quando blocos não materializam por completo", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const ws = prepareWorkspaceForV3PipelineAudit(input);
    const report = auditV3PipelineTurnBalance(ws);

    const withMatLoss = report.employees.filter((e) => e.turnsLostAfterMaterialization > 0);
    for (const row of withMatLoss) {
      expect(row.plannedTurns).toBeGreaterThan(row.materializedTurnsPlaced);
      expect(row.turnsAfterMaterialization).toBe(
        row.turnsBeforeMaterialization + row.materializedTurnsPlaced,
      );
    }
  });
});
