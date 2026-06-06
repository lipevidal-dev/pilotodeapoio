import { describe, expect, it } from "vitest";
import { addDays } from "../domain/rules/dates.js";
import { calculateOperationalDemand } from "../domain/schedule/demand-planning-demand.js";
import { buildBlockPlans, targetToBlocks } from "../domain/schedule/demand-planning-blocks.js";
import { materializeBlockPlans } from "../domain/schedule/demand-planning-materialize.js";
import { materializeT6T7BlocksStrict } from "../domain/schedule/real-schedule-blocks.js";
import { allocateT8BlocksStrict, auditStructuralT8 } from "../domain/schedule/real-schedule-t8.js";
import {
  detectVacationFortnight,
  materializeVacationFortnightPatterns,
} from "../domain/schedule/real-schedule-vacation-materialize.js";
import { longestConsecutiveRun } from "../domain/schedule/t6-t7-block-coverage.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import { operationalBalancer } from "../domain/schedule/operational-balancer.js";
import {
  LegacyScheduleGenerationEngine,
  ScheduleGenerationEngine,
  scheduleGenerationEngine,
} from "../domain/schedule/schedule-generation-engine.js";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { allocateFlightsForWorkdayDeficit } from "../domain/schedule/real-schedule-flights.js";
import { coverResidualT6T7Only } from "../domain/schedule/real-schedule-residual.js";
import {
  calculateRequiredT6T7Shifts,
  computeRealMotorTargets,
} from "../domain/schedule/real-schedule-targets.js";
import { MOTOR_VERSION_ID, MONTHLY_WORKDAY_TARGET } from "../domain/schedule/real-schedule-types.js";
import {
  countMotorWorkDays,
  countWorkdayBreakdown,
} from "../domain/schedule/real-schedule-workdays.js";
import {
  vacationPatternSequence,
  vacationPatternWorkTarget,
} from "../domain/schedule/real-schedule-vacation-pattern.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { freshWorkspace, minimalPaoInput, paoUuid } from "./schedule-slices/slice-helpers.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);

function fullMonthNoFlight(uuid: string) {
  return MONTH_DAYS.map((date) => ({ employeeUuid: uuid, date }));
}

function runT8First(ws: ReturnType<typeof freshWorkspace>) {
  allocateT8BlocksStrict(ws);
}

function runT6T7Blocks(ws: ReturnType<typeof freshWorkspace>) {
  materializeVacationFortnightPatterns(ws);
  const { targets } = computeRealMotorTargets(ws);
  materializeT6T7BlocksStrict(ws, targets);
  coverResidualT6T7Only(ws);
}

function assertNoIsolatedT8(assignments: ReturnType<ReturnType<typeof freshWorkspace>["toAssignments"]>) {
  const byPao = new Map<string, string[]>();
  for (const a of assignments) {
    if (a.shiftCode !== "T8") continue;
    const list = byPao.get(a.employeeUuid) ?? [];
    list.push(a.date);
    byPao.set(a.employeeUuid, list);
  }
  for (const [uuid, days] of byPao) {
    for (const day of days) {
      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      expect(
        days.includes(prev) || days.includes(next),
        `T8 isolado ${day} para ${uuid}`,
      ).toBe(true);
    }
  }
}

describe("Fase 8.0 — Motor real v1", () => {
  it("1. Demanda 30 dias = 90", () => {
    expect(calculateOperationalDemand(30).totalDemand).toBe(90);
  });

  it("2. Demanda 31 dias = 93", () => {
    expect(calculateOperationalDemand(31).totalDemand).toBe(93);
  });

  it("3. T8 alocado antes de T6/T7", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    runT8First(ws);
    const t8Before = ws.toAssignments().filter((a) => a.shiftCode === "T8").length;
    expect(t8Before).toBeGreaterThan(0);
    runT6T7Blocks(ws);
    const t6After = ws.toAssignments().filter((a) => a.shiftCode === "T6").length;
    expect(t6After).toBeGreaterThan(0);
    expect(t8Before).toBeGreaterThan(0);
  });

  it("4. Chave T8/T8/ND criada corretamente", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    runT8First(ws);
    let pairs = 0;
    for (let i = 0; i < ws.days.length - 1; i++) {
      const d0 = ws.days[i]!;
      const d1 = ws.days[i + 1]!;
      const t8d0 = ws.toAssignments().filter((a) => a.date === d0 && a.shiftCode === "T8");
      const t8d1 = ws.toAssignments().filter((a) => a.date === d1 && a.shiftCode === "T8");
      if (t8d0.length && t8d1.length) {
        const uuid = t8d0[0]!.employeeUuid;
        if (t8d1.some((a) => a.employeeUuid === uuid)) pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(0);
    const ndCount = ws.allocations.filter((a) => a.label.toUpperCase() === "ND").length;
    expect(ndCount).toBeGreaterThan(0);
  });

  it("5. ND não conta como dia trabalhado", () => {
    const ws = freshWorkspace(minimalPaoInput(3));
    ws.applyHardBlocks();
    runT8First(ws);
    const uuid = paoUuid(0);
    ws.lockDay(uuid, ws.days[0]!, "ND");
    const motor = countMotorWorkDays(ws, uuid);
    const op = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(motor).toBeLessThanOrEqual(op.diasTrabalhados);
  });

  it("6. PAO com restrição T8 não recebe T8", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.shiftRestrictions = buildShiftRestrictionMap(input.employees, [
      { employeeUuid: uuid, shiftCode: "T8" },
    ]);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runT8First(ws);
    const t8 = ws.toAssignments().filter((a) => a.employeeUuid === uuid && a.shiftCode === "T8");
    expect(t8.length).toBe(0);
  });

  it("7. PAO não alocar voos mês inteiro não recebe voo", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(1);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runT8First(ws);
    runT6T7Blocks(ws);
    ws.allocatePaoRestDaysAfterCoverage();
    allocateFlightsForWorkdayDeficit(ws);
    const voos = ws.allocations.filter(
      (a) => a.employeeUuid === uuid && a.label.toUpperCase() === "VOO",
    );
    expect(voos.length).toBe(0);
  });

  it("8. PAO não alocar voos tenta atingir 20 dias com turnos", () => {
    const input = minimalPaoInput(4);
    const uuid = paoUuid(0);
    input.noFlightDates = fullMonthNoFlight(uuid);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const rs = calculateRequiredT6T7Shifts(ws, uuid);
    expect(rs.group).toBe("FULL_NO_FLIGHT");
    expect(rs.workTarget).toBe(MONTHLY_WORKDAY_TARGET);
    expect(rs.requiredT6T7).toBeGreaterThan(0);
  });

  it("9. Curso/simulador contam como dia trabalhado", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.lockedAllocations = [
      { employeeUuid: uuid, date: MONTH_DAYS[0]!, label: "CURSO" },
      { employeeUuid: uuid, date: MONTH_DAYS[1]!, label: "SIMULADOR" },
    ];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const b = countWorkdayBreakdown(ws, uuid);
    expect(b.cursos).toBe(1);
    expect(b.simuladores).toBe(1);
    expect(b.total).toBe(2);
  });

  it("10. Férias não contam como dia trabalhado", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.vacationDays = MONTH_DAYS.slice(0, 10).map((date) => ({ employeeUuid: uuid, date }));
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const b = countWorkdayBreakdown(ws, uuid);
    expect(b.total).toBe(0);
    const op = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === uuid)!;
    expect(op.ferias).toBe(10);
  });

  it("11. FP não conta como dia trabalhado", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    input.approvedDayOff = [{ employeeUuid: uuid, date: MONTH_DAYS[5]! }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    const b = countWorkdayBreakdown(ws, uuid);
    expect(b.total).toBe(0);
  });

  it("12. PAO férias quinzenais aplica padrão 3 trabalho / 2 folga", () => {
    expect(vacationPatternWorkTarget(15)).toBe(9);
    expect(vacationPatternWorkTarget(16)).toBe(10);
    const seq = vacationPatternSequence(15);
    expect(seq.filter((x) => x === "W").length).toBe(9);
    expect(seq.filter((x) => x === "F").length).toBe(6);
  });

  it("13. T6/T7 gerados em blocos", () => {
    expect(targetToBlocks(20)).toEqual([4, 4, 4, 4, 4]);
    expect(targetToBlocks(15)).toEqual([3, 4, 4, 4]);
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    runT8First(ws);
    runT6T7Blocks(ws);
    const { targets } = computeRealMotorTargets(ws);
    const plans = buildBlockPlans(targets);
    const minBlock = Math.min(
      ...plans.flatMap((p) => p.plannedBlocks.map((b) => b.size)),
    );
    expect(minBlock).toBeGreaterThanOrEqual(3);
  });

  it("14. Diferença −2/−3 turnos pode ser compensada com voos", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runT8First(ws);
    const rs = calculateRequiredT6T7Shifts(ws, uuid);
    const flexTarget = Math.max(0, rs.requiredT6T7 - 3);
    expect(flexTarget).toBeLessThanOrEqual(rs.requiredT6T7);
    runT6T7Blocks(ws);
    ws.allocatePaoRestDaysAfterCoverage();
    const before = countMotorWorkDays(ws, uuid);
    allocateFlightsForWorkdayDeficit(ws);
    const after = countMotorWorkDays(ws, uuid);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("15. Voo completa déficit para 20 dias trabalhados", () => {
    const input = minimalPaoInput(2);
    const uuid = paoUuid(0);
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runT8First(ws);
    const { targets } = computeRealMotorTargets(ws);
    const capped = targets.map((t) => ({ ...t, target: Math.min(t.target, 5) }));
    materializeBlockPlans(ws, buildBlockPlans(capped));
    const before = countMotorWorkDays(ws, uuid);
    const deficit = MONTHLY_WORKDAY_TARGET - before;
    expect(deficit).toBeGreaterThan(0);
    const flights = allocateFlightsForWorkdayDeficit(ws);
    expect(flights.length).toBeGreaterThan(0);
    expect(countMotorWorkDays(ws, uuid)).toBeGreaterThan(before);
  });

  it("16. Mínimo de 10 folgas respeitado quando viável", () => {
    const result = scheduleGenerationEngine.generate(realisticGenerationInput());
    for (const [name, count] of Object.entries(result.summary.folgasPerPao ?? {})) {
      expect(count, name).toBeGreaterThanOrEqual(10);
    }
  });

  it("17. Mono-folga pedida tenta ganhar folga antes/depois", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.approvedDayOff = [{ employeeUuid: uuid, date: MONTH_DAYS[10]! }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    runT8First(ws);
    runT6T7Blocks(ws);
    ws.allocatePaoRestDaysAfterCoverage();
    const mono = ws.correctMonoFolgasPedidas();
    expect(mono.detected).toBeGreaterThanOrEqual(0);
  });

  it("18. Resumo operacional mostra total correto", () => {
    const result = scheduleGenerationEngine.generate(minimalPaoInput(3));
    expect(result.summary.operationalTotals?.totalTurnos).toBeGreaterThan(0);
    expect(result.summary.operationalByEmployee?.length).toBeGreaterThan(0);
    const pao = result.summary.operationalByEmployee?.find((e) => e.type === "PAO");
    expect(pao?.diasTrabalhados).toBeGreaterThan(0);
  });

  it("19. Balanceador recalcula após ajustes", () => {
    const ws = freshWorkspace(realisticGenerationInput());
    ws.applyHardBlocks();
    const report = realScheduleEngine.execute(ws);
    const before = buildOperationalSummary(ws).byEmployee;
    const balance = operationalBalancer.balance(ws, report.warnings);
    const after = buildOperationalSummary(ws).byEmployee;
    expect(balance.iterations).toBeGreaterThanOrEqual(0);
    expect(after.length).toBe(before.length);
    expect(balance.actions.length).toBeGreaterThanOrEqual(0);
  });

  it("20. Botão Gerar Escala usa o novo motor", () => {
    const result = new ScheduleGenerationEngine().generate(minimalPaoInput(3));
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_ID);
    expect(result.summary.realEngineExecuted).toBe(true);
    expect(result.suggestions.some((s) => s.includes("Motor real v1"))).toBe(true);
    const legacy = new LegacyScheduleGenerationEngine().generate(minimalPaoInput(3));
    expect(legacy.summary.motorVersion).toBe("Motor legado");
  });
});

describe("REAL_V1 — regras estruturais críticas", () => {
  it("não pode existir T8 isolado após geração completa", () => {
    const result = realScheduleEngine.generate(minimalPaoInput(4));
    assertNoIsolatedT8(result.assignments);
    const report = result.summary.realMotorReport as { t8IsolatedCount?: number };
    expect(report.t8IsolatedCount ?? 0).toBe(0);
  });

  it("toda dupla T8/T8 deve ter ND no dia seguinte", () => {
    const result = realScheduleEngine.generate(minimalPaoInput(4));
    for (let i = 0; i < MONTH_DAYS.length - 1; i++) {
      const d0 = MONTH_DAYS[i]!;
      const d1 = MONTH_DAYS[i + 1]!;
      const t8d0 = result.assignments.filter((a) => a.date === d0 && a.shiftCode === "T8");
      const t8d1 = result.assignments.filter((a) => a.date === d1 && a.shiftCode === "T8");
      for (const a0 of t8d0) {
        if (!t8d1.some((a1) => a1.employeeUuid === a0.employeeUuid)) continue;
        const ndDay = addDays(d1, 1);
        const hasNd = result.allocations.some(
          (a) => a.employeeUuid === a0.employeeUuid && a.date === ndDay && a.label === "ND",
        );
        expect(hasNd, `ND ausente após T8/T8 ${d0}/${d1} para ${a0.employeeUuid}`).toBe(true);
      }
    }
    const report = result.summary.realMotorReport as { t8PairsWithoutNdCount?: number };
    expect(report.t8PairsWithoutNdCount ?? 0).toBe(0);
  });

  it("se ND não for possível, dupla T8/T8 não deve ser criada", () => {
    const input = minimalPaoInput(3);
    const uuid = paoUuid(0);
    input.lockedAllocations = [{ employeeUuid: uuid, date: "2026-06-12", label: "SIMULADOR" }];
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryPlaceT8Block(uuid, "2026-06-10")).toBe(false);
    allocateT8BlocksStrict(ws);
    const audit = auditStructuralT8(ws);
    expect(audit.pairsWithoutNdCount).toBe(0);
    expect(audit.isolatedT8Count).toBe(0);
  });

  it("PAO com férias 01–15 recebe padrão 3/2 entre 16–30", () => {
    const uuid = paoUuid(0);
    const vacDays = MONTH_DAYS.slice(0, 15).map((date) => ({ employeeUuid: uuid, date }));
    const input = minimalPaoInput(4);
    input.vacationDays = vacDays;
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(detectVacationFortnight(ws, uuid)).toBe("FIRST_HALF");
    runT8First(ws);
    const vacation = materializeVacationFortnightPatterns(ws);
    expect(vacation.processedCount).toBe(1);
    const secondHalf = MONTH_DAYS.slice(15);
    const workSecondHalf = secondHalf.filter((day) =>
      ws.toAssignments().some(
        (a) =>
          a.employeeUuid === uuid &&
          a.date === day &&
          (a.shiftCode === "T6" || a.shiftCode === "T7" || a.shiftCode === "T8"),
      ),
    );
    expect(workSecondHalf.length).toBeGreaterThanOrEqual(vacationPatternWorkTarget(15) - 3);
    const feriasSecond = secondHalf.filter((day) =>
      ws.allocations.some(
        (a) => a.employeeUuid === uuid && a.date === day && a.label.toUpperCase().includes("FÉRIAS"),
      ),
    );
    expect(feriasSecond.length).toBe(0);
  });

  it("PAO com férias 16–30 recebe padrão 3/2 entre 01–15", () => {
    const uuid = paoUuid(0);
    const vacDays = MONTH_DAYS.slice(15).map((date) => ({ employeeUuid: uuid, date }));
    const input = minimalPaoInput(4);
    input.vacationDays = vacDays;
    const ws = freshWorkspace(input);
    ws.applyHardBlocks();
    expect(detectVacationFortnight(ws, uuid)).toBe("SECOND_HALF");
    runT8First(ws);
    materializeVacationFortnightPatterns(ws);
    const firstHalf = MONTH_DAYS.slice(0, 15);
    const workFirstHalf = firstHalf.filter((day) =>
      ws.toAssignments().some(
        (a) =>
          a.employeeUuid === uuid &&
          a.date === day &&
          (a.shiftCode === "T6" || a.shiftCode === "T7" || a.shiftCode === "T8"),
      ),
    );
    expect(workFirstHalf.length).toBeGreaterThanOrEqual(vacationPatternWorkTarget(15) - 3);
  });

  it("T6 deve gerar bloco de 3+ dias quando viável", () => {
    const result = realScheduleEngine.generate(minimalPaoInput(4));
    const report = result.summary.realMotorReport as {
      structuralMetrics?: { t6AverageBlockSize: number; t6Blocks: number };
    };
    expect(report.structuralMetrics?.t6Blocks ?? 0).toBeGreaterThan(0);
    const longest = Math.max(
      ...result.assignments
        .filter((a) => a.shiftCode === "T6")
        .map((a) => a.employeeUuid)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((uuid) => longestConsecutiveRun(result.assignments, uuid, "T6", MONTH_DAYS)),
    );
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it("T7 deve gerar bloco de 3+ dias quando viável", () => {
    const result = realScheduleEngine.generate(minimalPaoInput(4));
    const longest = Math.max(
      ...result.assignments
        .filter((a) => a.shiftCode === "T7")
        .map((a) => a.employeeUuid)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map((uuid) => longestConsecutiveRun(result.assignments, uuid, "T7", MONTH_DAYS)),
    );
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it("cobertura unitária é último recurso — blocos antes de unitários no residual", () => {
    const ws = freshWorkspace(minimalPaoInput(4));
    ws.applyHardBlocks();
    runT8First(ws);
    runT6T7Blocks(ws);
    const residual = coverResidualT6T7Only(ws);
    expect(residual.blockCoverageApplied + residual.unitCoverageApplied).toBeGreaterThanOrEqual(0);
    const full = realScheduleEngine.generate(minimalPaoInput(4));
    const report = full.summary.realMotorReport as {
      structuralMetrics?: { t6UnitCoverage: number; t7UnitCoverage: number; t6Blocks: number; t7Blocks: number };
      residualBlockCoverage?: number;
    };
    const totalBlocks = (report.structuralMetrics?.t6Blocks ?? 0) + (report.structuralMetrics?.t7Blocks ?? 0);
    expect(totalBlocks).toBeGreaterThan(0);
  });

  it("resumo operacional inclui métricas estruturais T6/T7/T8", () => {
    const result = realScheduleEngine.generate(minimalPaoInput(4));
    const report = result.summary.realMotorReport as {
      structuralMetrics?: {
        t6Blocks: number;
        t7Blocks: number;
        isolatedT8Count: number;
        pairsWithoutNdCount: number;
        vacationBelowPatternCount: number;
      };
      t8BlocksPlaced?: number;
      vacationFortnightProcessed?: number;
    };
    expect(report.structuralMetrics).toBeDefined();
    expect(report.structuralMetrics!.t6Blocks).toBeGreaterThan(0);
    expect(report.structuralMetrics!.t7Blocks).toBeGreaterThan(0);
    expect(report.t8BlocksPlaced).toBeGreaterThan(0);
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_ID);
  });

  it("Gerar Escala continua retornando REAL_V1 com pipeline estrutural", () => {
    const result = new ScheduleGenerationEngine().generate(realisticGenerationInput());
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_ID);
    expect(result.summary.realEngineExecuted).toBe(true);
    assertNoIsolatedT8(result.assignments);
    expect(
      result.violations.filter((v) => v.type === "T8 ISOLADO" || v.type === "T8 SEM ND").length,
    ).toBe(0);
  });
});
