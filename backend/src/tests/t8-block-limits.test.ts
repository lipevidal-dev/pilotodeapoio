import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import { allocateT8BlocksStrict, closeT8CoverageGaps } from "../domain/schedule/real-schedule-t8.js";
import { countT8BlocksForEmployee, MAX_T8_BLOCKS_PER_PAO_MONTH } from "../domain/schedule/t8-block-limits.js";
import { comparePaoForT8Coverage } from "../domain/schedule/t8-coverage-priority.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { minimalPaoInput } from "./generation-fixtures.js";
import { DEFAULT_SHIFTS } from "../domain/shift/default-shifts.js";

function pao(id: number, name: string, seniority: number): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name, role: "PAO", seniority },
  };
}

function inputWithPreferences(
  paoCount: number,
  preferredT8Ids: number[],
): GenerationInput {
  const employees = Array.from({ length: paoCount }, (_, i) =>
    pao(i + 1, `PAO ${i + 1}`, i + 1),
  );
  const preferredShifts = new Map<number, Set<string>>();
  for (const id of preferredT8Ids) {
    preferredShifts.set(id, new Set(["T8"]));
  }
  return {
    year: 2026,
    month: 6,
    employees,
    shifts: DEFAULT_SHIFTS,
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts,
  };
}

describe("t8-block-limits", () => {
  it("cobre todos os dias T8; PAO sem preferência T8 pode ficar sem bloco", () => {
    const input = inputWithPreferences(10, [1, 2, 3, 4, 5, 6, 7, 8]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.initRateioContext();
    allocateT8BlocksStrict(ws);
    closeT8CoverageGaps(ws);

    for (const day of ws.days) {
      expect(ws.hasPaoCoverage(day, "T8")).toBe(true);
    }

    const nonPrefBlocks = ["pao-9", "pao-10"].map((id) => countT8BlocksForEmployee(ws, id));
    expect(nonPrefBlocks.some((n) => n === 0)).toBe(true);
    for (const c of ws.paoEmps) {
      expect(countT8BlocksForEmployee(ws, c.uuid)).toBeLessThanOrEqual(MAX_T8_BLOCKS_PER_PAO_MONTH);
    }
  });

});

describe("t8-coverage-priority", () => {
  it("preferência T8 vence rateio entre candidatos elegíveis", () => {
    const input = inputWithPreferences(4, [1, 2]);
    const ws = new GenerationWorkspace(input);
    ws.initRateioContext();
    const ctx = ws.rateioContext!;
    const preferrer = ws.paoEmps.find((e) => e.uuid === "pao-1")!;
    const other = ws.paoEmps.find((e) => e.uuid === "pao-3")!;

    ctx.currentTurnCounts.set(preferrer.uuid, 2);
    ctx.currentTurnCounts.set(other.uuid, 0);
    ctx.minTurnCounts.set(other.uuid, 10);
    ctx.minTurnCounts.set(preferrer.uuid, 10);

    expect(comparePaoForT8Coverage(ws, ctx, preferrer, other)).toBeLessThan(0);
  });

  it("PAO sem preferência T8 pode ficar com 0 blocos quando preferentes cobrem", () => {
    const input = inputWithPreferences(10, [1, 2, 3, 4, 5, 6, 7, 8]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.initRateioContext();
    allocateT8BlocksStrict(ws);
    closeT8CoverageGaps(ws);

    for (const day of ws.days) {
      expect(ws.hasPaoCoverage(day, "T8")).toBe(true);
    }

    const nonPref = ws.paoEmps.filter((e) => e.uuid === "pao-9" || e.uuid === "pao-10");
    const nonPrefBlocks = nonPref.map((c) => countT8BlocksForEmployee(ws, c.uuid));
    expect(nonPrefBlocks.some((n) => n === 0)).toBe(true);

    const prefTotal = [1, 2, 3, 4, 5, 6, 7, 8].reduce(
      (sum, id) => sum + countT8BlocksForEmployee(ws, `pao-${id}`),
      0,
    );
    const nonPrefTotal = nonPrefBlocks.reduce((a, b) => a + b, 0);
    expect(prefTotal).toBeGreaterThan(nonPrefTotal);
  });

  it("motor completo: cobertura T8 100%, validateBeforeSave e T8/T8/ND OK", () => {
    const base = minimalPaoInput(6);
    const input: GenerationInput = {
      ...base,
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
        [3, new Set(["T7"])],
      ]),
    };
    const result = new RealScheduleEngine().generate(input);
    expect(result.summary.coverageGaps).toBe(0);
    const report = result.summary.realMotorReport as { t8IsolatedCount?: number; t8PairsWithoutNdCount?: number };
    expect(report.t8IsolatedCount ?? 0).toBe(0);
    expect(report.t8PairsWithoutNdCount ?? 0).toBe(0);
  });
});
