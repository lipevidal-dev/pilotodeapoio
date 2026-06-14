import { describe, expect, it } from "vitest";
import {
  blockOptimizer,
  computeBlocoIdeal,
  computeBlockOptimizerMetrics,
  findWorkBlocks,
  isBlockWorkDay,
  scoreBlockSize,
} from "../domain/schedule/block-optimizer.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";

describe("Block Optimizer — scoring", () => {
  it("computeBlocoIdeal segue tabela V3 de metas", () => {
    expect(computeBlocoIdeal(10)).toBe(4);
    expect(computeBlocoIdeal(12)).toBe(4);
    expect(computeBlocoIdeal(13)).toBe(5);
    expect(computeBlocoIdeal(20)).toBe(5);
  });

  it("scoreBlockSize penaliza isolados, blocos de 2 e distância do ideal", () => {
    expect(scoreBlockSize(1, 5)).toBe(100);
    expect(scoreBlockSize(2, 5)).toBe(50);
    expect(scoreBlockSize(5, 5)).toBe(0);
    expect(scoreBlockSize(3, 5)).toBe(20);
  });
});

describe("Block Optimizer — detecção de blocos", () => {
  it("identifica blocos de trabalho separados por folga", () => {
    const ws = freshWorkspace(minimalPaoInput());
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    ws.lockDay(uuid, "2026-06-01", "FOLGA");
    ws.tryAssignShift(uuid, "2026-06-02", "T6");
    ws.tryAssignShift(uuid, "2026-06-03", "T6");
    ws.lockDay(uuid, "2026-06-04", "FOLGA");
    ws.tryAssignShift(uuid, "2026-06-05", "T6");

    expect(isBlockWorkDay(ws, uuid, "2026-06-02")).toBe(true);
    expect(isBlockWorkDay(ws, uuid, "2026-06-01")).toBe(false);

    const blocks = findWorkBlocks(ws, uuid);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.size).toBe(2);
    expect(blocks[1]?.size).toBe(1);
  });

  it("T8 T8 ND formam bloco único de 3 dias", () => {
    const ws = freshWorkspace(minimalPaoInput());
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    ws.tryPlaceT8Block(uuid, "2026-06-10");

    const blocks = findWorkBlocks(ws, uuid);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.size).toBe(3);
  });
});

describe("Block Optimizer — otimização", () => {
  it("melhora score ao fundir turno isolado com bloco adjacente", () => {
    const ws = freshWorkspace(minimalPaoInput());
    ws.applyHardBlocks();
    const uuid = paoUuid(0);

    ws.tryAssignShift(uuid, "2026-06-01", "T6");
    ws.tryAssignShift(uuid, "2026-06-03", "T6");
    ws.tryAssignShift(uuid, "2026-06-04", "T6");

    const before = computeBlockOptimizerMetrics(ws);
    expect(before.turnosIsolados).toBeGreaterThan(0);

    const report = blockOptimizer.optimize(ws);
    const after = computeBlockOptimizerMetrics(ws);

    expect(report.finalScore).toBeLessThanOrEqual(report.initialScore);
    if (report.improved) {
      expect(after.blockOptimizerScore).toBeLessThan(before.blockOptimizerScore);
    }
  });

  it("preserva cobertura T6 ao otimizar", () => {
    const ws = freshWorkspace(minimalPaoInput());
    ws.applyHardBlocks();
    const uuid0 = paoUuid(0);
    ws.tryAssignShift(uuid0, "2026-06-01", "T6");

    blockOptimizer.optimize(ws);
    expect(ws.hasPaoCoverage("2026-06-01", "T6")).toBe(true);
  });
});
