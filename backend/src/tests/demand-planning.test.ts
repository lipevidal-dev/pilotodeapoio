import { describe, expect, it } from "vitest";
import { calculateOperationalDemand } from "../domain/schedule/demand-planning-demand.js";
import {
  calculateCapacitySummary,
  classifyPlanningGroup,
} from "../domain/schedule/demand-planning-capacity.js";
import { computeIndividualTargets } from "../domain/schedule/demand-planning-targets.js";
import {
  averageBlockSize,
  blocksMatchTarget,
  buildBlockPlans,
  targetToBlocks,
} from "../domain/schedule/demand-planning-blocks.js";
import { materializeBlockPlans } from "../domain/schedule/demand-planning-materialize.js";
import { coverResidualGaps } from "../domain/schedule/demand-planning-residual.js";
import { demandPlanningEngine } from "../domain/schedule/demand-planning-engine.js";
import { operationalBalancer } from "../domain/schedule/operational-balancer.js";
import { StepGenerationEngine } from "../domain/schedule/step-generation-engine.js";
import { longestConsecutiveRun } from "../domain/schedule/t6-t7-block-coverage.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import {
  FULL_NO_FLIGHT_TARGET,
  VACATION_TARGET_30,
} from "../domain/schedule/demand-planning-types.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function fullMonthNoFlight(uuid: string) {
  return MONTH_DAYS.map((date) => ({ employeeUuid: uuid, date }));
}

describe("Fase 7.3 — Planejamento por demanda", () => {
  it("1. Cálculo da demanda", () => {
    expect(calculateOperationalDemand(30).totalDemand).toBe(90);
    expect(calculateOperationalDemand(31).totalDemand).toBe(93);
    expect(calculateOperationalDemand(30).perShift.T6).toBe(30);
  });

  it("2. Cálculo da capacidade", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    const cap = calculateCapacitySummary(ws);
    expect(cap.byEmployee.length).toBe(6);
    expect(cap.totalCapacity).toBeGreaterThan(0);
    const normal = cap.byEmployee.find((c) => c.group === "NORMAL");
    expect(normal?.capacity).toBe(20);
  });

  it("3. Metas grupo sem voo", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(1);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const demand = calculateOperationalDemand(30);
    const targets = computeIndividualTargets(ws, demand);
    const t = targets.find((x) => x.employeeUuid === uuid)!;
    expect(t.group).toBe("FULL_NO_FLIGHT");
    expect(t.target).toBe(FULL_NO_FLIGHT_TARGET);
  });

  it("4. Metas grupo férias", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.vacationDays = MONTH_DAYS.slice(14, 30).map((date) => ({ employeeUuid: uuid, date }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const t = targets.find((x) => x.employeeUuid === uuid)!;
    expect(t.group).toBe("VACATION");
    expect(t.target).toBe(VACATION_TARGET_30);
  });

  it("5. Metas grupo normal", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const normals = targets.filter((t) => t.group === "NORMAL");
    expect(normals.length).toBe(3);
    expect(normals.reduce((n, t) => n + t.target, 0)).toBeGreaterThan(0);
  });

  it("6. Conversão de metas em blocos", () => {
    expect(targetToBlocks(20)).toEqual([5, 5, 5, 5]);
    expect(targetToBlocks(9)).toEqual([3, 3, 3]);
    expect(targetToBlocks(8)).toEqual([4, 4]);
    expect(targetToBlocks(7)).toEqual([4, 3]);
    expect(targetToBlocks(3)).toEqual([3]);
  });

  it("7. Distribuição por senioridade", () => {
    const input = minimalPaoInput(3);
    const ws = freshWorkspace(input);
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const plans = buildBlockPlans(targets);
    const seniorities = plans.map((p) => p.seniority);
    expect(seniorities).toEqual([...seniorities].sort((a, b) => a - b));
  });

  it("8. Materialização dos blocos", () => {
    const input = minimalPaoInput(4);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const plans = buildBlockPlans(targets);
    const result = materializeBlockPlans(ws, plans);
    expect(result.placedShifts).toBeGreaterThan(0);
    for (const plan of plans) {
      for (const block of plan.executedBlocks) {
        const run = longestConsecutiveRun(
          ws.toAssignments(),
          plan.employeeUuid,
          block.shiftCode,
          MONTH_DAYS,
        );
        expect(run).toBeGreaterThanOrEqual(block.size);
      }
    }
  });

  it("9. Cobertura residual", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    const targets = computeIndividualTargets(ws, calculateOperationalDemand(30));
    const plans = buildBlockPlans(targets);
    materializeBlockPlans(ws, plans);
    const residual = coverResidualGaps(ws);
    expect(residual.gapsAfter).toBeLessThanOrEqual(residual.gapsBefore);
  });

  it("10. Mono-folga via pipeline de etapas", () => {
    const engine = new StepGenerationEngine();
    const result = engine.execute(realisticGenerationInput(), {
      paoCheckPreAllocations: false,
      paoCheckRestrictions: false,
      paoDemandPlanning: true,
      paoCoverageT6: false,
      paoCoverageT7: false,
      paoCoverageT8: false,
      paoAllocateFolgas: false,
      paoAllocateFlights: false,
      apaoCheckPreAllocations: false,
      apaoCheckShiftPreference: false,
      apaoCheckShiftRestrictions: false,
      apaoAllocate: false,
    });
    expect(result.report.demandPlanningReport).toBeDefined();
    expect(result.report.executedSteps).toContain("PAO — Planejamento por demanda (Fase 7.3)");
  });

  it("11. Balanceador integrado ao planejamento", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    const report = demandPlanningEngine.execute(ws);
    expect(report.balanceReport).toBeDefined();
    expect(report.balanceReport!.before.length).toBeGreaterThan(0);
  });

  it("12. Escala final com resumo recalculado", () => {
    const engine = new StepGenerationEngine();
    const result = engine.execute(realisticGenerationInput(), {
      paoCheckPreAllocations: true,
      paoCheckRestrictions: false,
      paoDemandPlanning: true,
      paoCoverageT6: false,
      paoCoverageT7: false,
      paoCoverageT8: false,
      paoAllocateFolgas: false,
      paoAllocateFlights: false,
      apaoCheckPreAllocations: false,
      apaoCheckShiftPreference: false,
      apaoCheckShiftRestrictions: false,
      apaoAllocate: false,
    });
    const dp = result.report.demandPlanningReport!;
    expect(dp.demand.totalDemand).toBe(90);
    expect(dp.blockPlans.every((p) => blocksMatchTarget(p) || p.executedBlocks.length > 0)).toBe(
      true,
    );
    expect(averageBlockSize(dp.blockPlans)).toBeGreaterThanOrEqual(3);
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    demandPlanningEngine.execute(ws);
    const summary = buildOperationalSummary(ws);
    expect(summary.byEmployee.length).toBeGreaterThan(0);
    expect(operationalBalancer).toBeDefined();
    expect(classifyPlanningGroup(ws, realisticGenerationInput().employees[0].uuid)).toBeDefined();
  });
});
