import type { IndividualTarget, EmployeeBlockPlan } from "./demand-planning-types.js";
import {
  BLOCK_IDEAL_SIZE,
  BLOCK_MAX_SIZE,
  BLOCK_MIN_SIZE,
} from "./demand-planning-types.js";

/** Etapa 4 — Converte meta em blocos (3–5 dias, ideal 4). */
export function targetToBlocks(target: number): number[] {
  if (target <= 0) return [];
  if (target <= BLOCK_MAX_SIZE) return finishSmall(target);
  if (target === 6 || target === 7 || target === 8 || target === 9) return finishSmall(target);

  const blocks: number[] = [];
  let rem = target;

  if (rem % BLOCK_IDEAL_SIZE === 0) {
    return Array.from({ length: rem / BLOCK_IDEAL_SIZE }, () => BLOCK_IDEAL_SIZE);
  }
  if (rem % BLOCK_IDEAL_SIZE === 1 && rem >= 9) {
    blocks.push(5);
    rem -= 5;
    return [...blocks, ...Array.from({ length: rem / BLOCK_IDEAL_SIZE }, () => BLOCK_IDEAL_SIZE)];
  }
  if (rem % BLOCK_IDEAL_SIZE === 2 && rem >= 6) {
    blocks.push(3, 3);
    rem -= 6;
    return [...blocks, ...Array.from({ length: rem / BLOCK_IDEAL_SIZE }, () => BLOCK_IDEAL_SIZE)];
  }
  if (rem % BLOCK_IDEAL_SIZE === 3) {
    blocks.push(3);
    rem -= 3;
    return [...blocks, ...Array.from({ length: rem / BLOCK_IDEAL_SIZE }, () => BLOCK_IDEAL_SIZE)];
  }

  while (rem > BLOCK_MAX_SIZE) {
    blocks.push(BLOCK_IDEAL_SIZE);
    rem -= BLOCK_IDEAL_SIZE;
  }
  blocks.push(...finishSmall(rem));
  return blocks;
}

function finishSmall(rem: number): number[] {
  if (rem <= 0) return [];
  if (rem === 7) return [4, 3];
  if (rem === 8) return [4, 4];
  if (rem === 9) return [3, 3, 3];
  if (rem === 6) return [3, 3];
  if (rem >= BLOCK_MIN_SIZE) return [rem];
  if (rem === 1 || rem === 2) return [rem];
  return [rem];
}

/** Etapa 5 — Distribui blocos por grupo e senioridade crescente. */
export function buildBlockPlans(targets: IndividualTarget[]): EmployeeBlockPlan[] {
  const ordered = [...targets].sort(
    (a, b) =>
      groupOrder(a.group) - groupOrder(b.group) ||
      a.seniority - b.seniority,
  );

  return ordered.map((t) => {
    const sizes = targetToBlocks(t.target);
    return {
      employeeUuid: t.employeeUuid,
      name: t.name,
      group: t.group,
      seniority: t.seniority,
      target: t.target,
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
