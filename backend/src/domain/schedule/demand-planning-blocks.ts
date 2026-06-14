import type { IndividualTarget, EmployeeBlockPlan } from "./demand-planning-types.js";
import {
  idealBlockSizeForTarget,
  idealBlockSpacing,
  plannedBlockCountForTarget,
  targetToBlocksV3,
} from "./motor-v3-planning.js";

/** Etapa 4 V3 — Converte meta Yf em Zf blocos (Bf=4 se Yf≤12, senão Bf=5). */
export function targetToBlocks(target: number): number[] {
  return targetToBlocksV3(target);
}

export {
  idealBlockSizeForTarget,
  idealBlockSpacing,
  plannedBlockCountForTarget,
  targetToBlocksV3,
};

/** Etapa 5 — Distribui blocos por grupo e senioridade crescente. */
export function buildBlockPlans(targets: IndividualTarget[]): EmployeeBlockPlan[] {
  const ordered = [...targets].sort(
    (a, b) =>
      groupOrder(a.group) - groupOrder(b.group) ||
      a.seniority - b.seniority,
  );

  return ordered.map((t) => {
    const sizes = targetToBlocks(t.target);
    const bf = idealBlockSizeForTarget(t.target);
    const zf = plannedBlockCountForTarget(t.target);
    return {
      employeeUuid: t.employeeUuid,
      name: t.name,
      group: t.group,
      seniority: t.seniority,
      target: t.target,
      idealBlockSize: bf,
      plannedBlockCount: zf,
      plannedBlocks: sizes.map((size) => ({ size })),
      executedBlocks: [],
    };
  });
}

function groupOrder(group: IndividualTarget["group"]): number {
  if (group === "FULL_NO_FLIGHT") return 0;
  if (group === "VACATION") return 1;
  return 2;
}

export function averageBlockSize(plans: EmployeeBlockPlan[]): number {
  const sizes = plans.flatMap((p) => p.plannedBlocks.map((b) => b.size));
  if (sizes.length === 0) return 0;
  return Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 10) / 10;
}

export function plannedBlockCount(plans: EmployeeBlockPlan[]): number {
  return plans.reduce((n, p) => n + p.plannedBlocks.length, 0);
}

export function blocksMatchTarget(plan: EmployeeBlockPlan): boolean {
  const sum = plan.plannedBlocks.reduce((n, b) => n + b.size, 0);
  return sum === plan.target || (plan.target <= 2 && sum === plan.target);
}
