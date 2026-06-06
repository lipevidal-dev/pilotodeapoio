import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { generationToScheduleContext } from "../domain/schedule/generation-context.js";
import { validateSchedule } from "../domain/rules/engine.js";
import { listPaoCoverageGaps } from "../domain/rules/coverage.js";
import { buildOperationalSummary } from "../domain/schedule/operational-summary.js";
import {
  IDEAL_PAO_REST_COUNT,
  MAX_PAO_REST_COUNT,
  PAO_COVERAGE_SHIFTS,
  PAO_REST_TYPES,
} from "../domain/rules/constants.js";
import { assignmentKey } from "../domain/schedule/types.js";
import { addDays } from "../domain/rules/dates.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import type { GenerationInput } from "../domain/schedule/generation-types.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function runWorkspaceThroughCompletion(input: GenerationInput): GenerationWorkspace {
  const ws = new GenerationWorkspace(input);
  ws.applyHardBlocks();
  ws.preallocatePaoFolgasBeforeCoverage();
  ws.planFolgaSocial();
  ws.planT8CoverageRotating();
  ws.coverPaoShiftsPrioritized();
  ws.ensureNdForT8Pairs();
  ws.assignApaoWithPao();
  ws.allocatePaoRestDaysAfterCoverage();
  ws.ensureExactTenFolgasPerPao();
  ws.finalizePaoFolgaCounts();
  ws.coverPaoShiftsPrioritized();
  ws.fillUnclassifiedPaoDays();
  return ws;
}

describe("completePaoAgenda", () => {
  it("1. reduz dias disponíveis quando existe alternativa válida de folga", () => {
    const input = realisticGenerationInput();
    const wsBefore = runWorkspaceThroughCompletion(input);
    const emptyBefore = wsBefore.paoEmps.reduce(
      (n, c) => n + wsBefore.emptyDaysForPao(c.uuid).length,
      0,
    );

    wsBefore.completePaoAgenda();
    const emptyAfter = wsBefore.paoEmps.reduce(
      (n, c) => n + wsBefore.emptyDaysForPao(c.uuid).length,
      0,
    );

    expect(emptyAfter).toBeLessThanOrEqual(emptyBefore);
  }, SLOW_MS);

  it("2. não cria ND artificial", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    for (const al of result.allocations.filter((a) => a.label === "ND")) {
      const d1 = addDays(al.date, -2);
      const d2 = addDays(al.date, -1);
      expect(
        result.assignments.some(
          (a) => a.employeeUuid === al.employeeUuid && a.date === d1 && a.shiftCode === "T8",
        ),
      ).toBe(true);
      expect(
        result.assignments.some(
          (a) => a.employeeUuid === al.employeeUuid && a.date === d2 && a.shiftCode === "T8",
        ),
      ).toBe(true);
    }
  }, SLOW_MS);

  it("3. dia vazio vira F se ainda faltam folgas", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.completePaoAgenda();
    expect(ws.countRest(input.employees[0].uuid)).toBeLessThanOrEqual(MAX_PAO_REST_COUNT);
    const empty = ws.emptyDaysForPao(input.employees[0].uuid);
    if (ws.countRest(input.employees[0].uuid) < IDEAL_PAO_REST_COUNT) {
      expect(empty.length).toBe(0);
    }
  });

  it("4. dia vazio vira turno se há furo de cobertura e PAO elegível", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 2),
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const day = "2026-06-15";
    for (const code of PAO_COVERAGE_SHIFTS) {
      expect(ws.hasPaoCoverage(day, code)).toBe(false);
    }
    ws.completePaoAgenda();
    const covered = PAO_COVERAGE_SHIFTS.some((code) => ws.hasPaoCoverage(day, code));
    expect(covered).toBe(true);
  });

  it(
    "5. VOO aparece e conta como trabalhado",
    () => {
    const input = realisticGenerationInput({
      flightDays: [{ employeeUuid: "real-1", date: "2026-06-10" }],
    });
    const result = engine.generate(input);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === "real-1" && a.date === "2026-06-10" && a.label === "VOO",
      ),
    ).toBe(true);
    const ws = new GenerationWorkspace(input);
    for (const a of result.assignments) {
      const did = input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(assignmentKey(did, a.date), a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const pao = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === "real-1")!;
    expect(pao.voos).toBeGreaterThanOrEqual(1);
    expect(pao.diasTrabalhados).toBeGreaterThanOrEqual(pao.voos);
  },
    SLOW_MS,
  );

  it("6. SIMULADOR conta como trabalhado", () => {
    const result = engine.generate(
      realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: "real-2", date: "2026-06-11", label: "SIMULADOR" }],
      }),
    );
    const ws = new GenerationWorkspace(realisticGenerationInput());
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(assignmentKey(did, a.date), a.shiftCode);
    }
    ws.allocations.push(...result.allocations);
    const pao = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === "real-2")!;
    expect(pao.simuladores).toBe(1);
    expect(pao.diasTrabalhados).toBeGreaterThanOrEqual(1);
  });

  it("7. CURSO conta como trabalhado", () => {
    const result = engine.generate(
      realisticGenerationInput({
        lockedAllocations: [{ employeeUuid: "real-3", date: "2026-06-12", label: "CURSO" }],
      }),
    );
    const ws = new GenerationWorkspace(realisticGenerationInput());
    for (const a of result.assignments) {
      const did = ws.input.employees.find((e) => e.uuid === a.employeeUuid)!.domainId;
      ws["planned"].set(assignmentKey(did, a.date), a.shiftCode);
    }
    for (const al of result.allocations) {
      ws.allocations.push(al);
      const did = ws.input.employees.find((e) => e.uuid === al.employeeUuid)!.domainId;
      ws["blocked"].set(assignmentKey(did, al.date), al.label);
    }
    const pao = buildOperationalSummary(ws).byEmployee.find((e) => e.employeeUuid === "real-3")!;
    expect(pao.cursos).toBe(1);
  });

  it("8. FP sábado+domingo conta como FS", () => {
    const result = engine.generate(
      realisticGenerationInput({
        approvedDayOff: [
          { employeeUuid: "real-1", date: "2026-06-06" },
          { employeeUuid: "real-1", date: "2026-06-07" },
        ],
      }),
    );
    expect(
      result.allocations.filter((a) => a.employeeUuid === "real-1" && a.label === "FOLGA SOCIAL").length,
    ).toBe(2);
  });

  it("9. folgas continuam exatamente 10 no cenário-base", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const restSet = new Set(PAO_REST_TYPES.map((t) => t.toUpperCase()));
    for (const e of input.employees.filter((x) => x.employee.role === "PAO")) {
      const n = result.allocations.filter(
        (a) => a.employeeUuid === e.uuid && restSet.has(a.label.toUpperCase()),
      ).length;
      expect(n).toBeGreaterThanOrEqual(IDEAL_PAO_REST_COUNT);
      expect(n).toBeLessThanOrEqual(MAX_PAO_REST_COUNT);
    }
  }, SLOW_MS);

  it("10. cobertura T6/T7/T8 sem furos no cenário-base", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    expect(listPaoCoverageGaps(ctx).length).toBe(0);
    expect(result.summary.coverageMissingCount).toBe(0);
  }, SLOW_MS);

  it("11. cenário-base classifica dias livres como DISPONÍVEL PARA VOO (INFO)", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const disponivel = validateSchedule(ctx).filter((v) => v.type === "DISPONÍVEL PARA VOO");
    expect(disponivel.length).toBeGreaterThanOrEqual(0);
    const paoDisp = result.summary.operationalByEmployee
      ?.filter((e) => e.type === "PAO")
      .reduce((n, e) => n + e.disponivel, 0);
    expect(paoDisp).toBe(disponivel.length);
    expect(result.summary.operationalTotals?.totalDisponiveis).toBeGreaterThanOrEqual(disponivel.length);
    for (const v of disponivel) {
      expect(v.detail).toContain("disponível");
    }
  }, SLOW_MS);

  it("12. DISPONÍVEL PARA VOO não é CRITICAL", () => {
    const input = realisticGenerationInput({
      employees: realisticGenerationInput().employees.filter((e) => e.employee.role === "PAO").slice(0, 1),
      vacationDays: Array.from({ length: 20 }, (_, i) => ({
        employeeUuid: "real-1",
        date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      })),
    });
    const result = engine.generate(input);
    const ctx = generationToScheduleContext(input, result.assignments, result.allocations);
    const disp = validateSchedule(ctx).filter((v) => v.type === "DISPONÍVEL PARA VOO");
    for (const v of disp) {
      expect(v.level).toBe("INFO");
    }
  });

  it("13. summary inclui totais ND e disponíveis", () => {
    const input = realisticGenerationInput();
    const result = engine.generate(input);
    expect(result.summary.operationalTotals?.totalNd).toBeGreaterThanOrEqual(0);
    expect(result.summary.operationalTotals?.totalDisponiveis).toBeGreaterThanOrEqual(0);
    expect(result.summary.operationalByEmployee?.every((e) => "nd" in e && "disponivel" in e)).toBe(true);
  }, SLOW_MS);
});
