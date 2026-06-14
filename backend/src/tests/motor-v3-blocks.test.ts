import { describe, expect, it } from "vitest";
import {
  idealBlockSizeForTarget,
  idealBlockSpacing,
  plannedBlockCountForTarget,
  scoreBlockQuality,
  targetToBlocksV3,
} from "../domain/schedule/motor-v3-planning.js";
import { targetToBlocks } from "../domain/schedule/demand-planning-blocks.js";
import { materializeBlockPlans } from "../domain/schedule/demand-planning-materialize.js";
import { buildBlockPlans } from "../domain/schedule/demand-planning-blocks.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";
import { computeIndividualTargets } from "../domain/schedule/demand-planning-targets.js";
import { calculateOperationalDemand } from "../domain/schedule/demand-planning-demand.js";

describe("Motor V3 — planejamento por blocos", () => {
  it("Bf = 4 se Yf ≤ 12, senão Bf = 5", () => {
    expect(idealBlockSizeForTarget(12)).toBe(4);
    expect(idealBlockSizeForTarget(13)).toBe(5);
    expect(idealBlockSizeForTarget(20)).toBe(5);
  });

  it("Zf = ceil(Yf / Bf)", () => {
    expect(plannedBlockCountForTarget(13)).toBe(3);
    expect(plannedBlockCountForTarget(20)).toBe(4);
    expect(plannedBlockCountForTarget(12)).toBe(3);
  });

  it("Xf = diasDisponiveis / Zf", () => {
    expect(idealBlockSpacing(28, 4)).toBe(7);
    expect(idealBlockSpacing(30, 3)).toBe(10);
  });

  it("targetToBlocks V3 decompõe metas sem blocos de 1–2 quando possível", () => {
    expect(targetToBlocks(20)).toEqual([5, 5, 5, 5]);
    expect(targetToBlocks(15)).toEqual([5, 5, 5]);
    expect(targetToBlocks(13)).toEqual([5, 4, 4]);
    expect(targetToBlocks(12)).toEqual([4, 4, 4]);
    expect(targetToBlocks(9)).toEqual([3, 3, 3]);
    expect(targetToBlocks(8)).toEqual([4, 4]);
    expect(targetToBlocks(7)).toEqual([4, 3]);
    expect(targetToBlocks(3)).toEqual([3]);
  });

  it("soma dos blocos sempre iguala Yf", () => {
    for (const yf of [3, 7, 9, 12, 13, 15, 18, 20]) {
      const blocks = targetToBlocksV3(yf);
      expect(blocks.reduce((a, b) => a + b, 0)).toBe(yf);
    }
  });

  it("função de qualidade penaliza isolados, blocos de 2 e distância do ideal", () => {
    expect(scoreBlockQuality(1, 20)).toBe(100);
    expect(scoreBlockQuality(2, 20)).toBe(50);
    expect(scoreBlockQuality(5, 20)).toBe(0);
    expect(scoreBlockQuality(3, 20)).toBe(20);
  });

  it("materialização distribui blocos com espaçamento (não empilha no início)", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const plans = buildBlockPlans(targets.filter((t) => t.group === "NORMAL" && t.target >= 9));

    materializeBlockPlans(ws, plans);

    for (const plan of plans) {
      if (plan.executedBlocks.length < 2) continue;
      const starts = plan.executedBlocks.map((b) => ws.days.indexOf(b.startDate));
      starts.sort((a, b) => a - b);
      const gap = starts[1]! - starts[0]!;
      expect(gap).toBeGreaterThan(plan.executedBlocks[0]!.size);
    }
  });

  it("buildBlockPlans inclui metadados V3 (Bf, Zf)", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const plan = buildBlockPlans(targets).find((p) => p.target === 20);
    expect(plan?.idealBlockSize).toBe(5);
    expect(plan?.plannedBlockCount).toBe(4);
    expect(plan?.plannedBlocks).toHaveLength(4);
  });
});

describe("Motor V3 — blocos não empilham no mesmo PAO", () => {
  it("PAO com meta 12 recebe blocos de tamanho 4", () => {
    const blocks = targetToBlocks(12);
    expect(blocks.every((s) => s >= 3 && s <= 5)).toBe(true);
    expect(blocks.reduce((a, b) => a + b, 0)).toBe(12);
  });
});
