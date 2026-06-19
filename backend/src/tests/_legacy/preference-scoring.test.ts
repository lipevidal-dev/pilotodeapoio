import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  buildPreferenceQuartileSummary,
  buildPreferenceSeniorityAudit,
  buildSeniorityWeightIndex,
  formatPreferenceSeniorityAudit,
  preferenceScoreForShift,
} from "../domain/schedule/preference-scoring.js";
import { sortPaoForCoverageCandidates } from "../domain/schedule/real-schedule-turn-rateio.js";
import { sortPaoByRateioPriority } from "../domain/schedule/schedule-rateio-context.js";
import { canAssignShiftWithRateio } from "../domain/schedule/assignment-eligibility.js";

function pao(id: number, name: string, seniority: number): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name, role: "PAO", seniority },
  };
}

function minimalInput(
  employees: GenerationInputEmployee[],
  preferred?: Map<number, Set<string>>,
): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees,
    shifts: [
      { code: "T6", name: "T6", role: "PAO", active: true, startTime: "06:00", endTime: "14:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T7", name: "T7", role: "PAO", active: true, startTime: "14:00", endTime: "22:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T8", name: "T8", role: "PAO", active: true, startTime: "22:00", endTime: "06:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    preferredShifts: preferred,
  };
}

describe("computePreferenceWeight", () => {
  it("mais antigo recebe peso maior que mais novo", () => {
    const ws = new GenerationWorkspace(
      minimalInput([pao(1, "Antonio", 1), pao(2, "Bruno", 2), pao(3, "Carlos", 3)]),
    );
    const weights = buildSeniorityWeightIndex(ws);
    expect(weights.get("pao-1")!).toBeGreaterThan(weights.get("pao-3")!);
    expect(weights.get("pao-1")).toBe(1.5);
    expect(weights.get("pao-3")).toBe(1);
  });

  it("preferenceScore aplica 30 * peso somente no turno preferido", () => {
    const input = minimalInput(
      [pao(1, "Antonio", 1), pao(2, "Bruno", 20)],
      new Map([[1, new Set(["T7"])], [2, new Set(["T7"])]]),
    );
    const ws = new GenerationWorkspace(input);
    ws.initRateioContext();
    const ctx = ws.rateioContext!;

    const seniorScore = preferenceScoreForShift(ws, ctx, "pao-1", "T7");
    const juniorScore = preferenceScoreForShift(ws, ctx, "pao-2", "T7");
    expect(seniorScore).toBeGreaterThan(juniorScore);
    expect(preferenceScoreForShift(ws, ctx, "pao-1", "T6")).toBe(0);
  });
});

describe("sort com preferência ponderada", () => {
  it("prioriza PAO mais antigo com preferência T7 em empate de rateio", () => {
    const input = minimalInput(
      [pao(1, "Antonio", 1), pao(2, "Bruno", 20)],
      new Map([[1, new Set(["T7"])], [2, new Set(["T7"])]]),
    );
    const ws = new GenerationWorkspace(input);
    ws.initRateioContext();
    const sorted = sortPaoForCoverageCandidates(ws, 0, undefined, "T7");
    expect(sorted[0]!.uuid).toBe("pao-1");
  });

  it("sortPaoByRateioPriority favorece senior com preferência no turno", () => {
    const input = minimalInput(
      [pao(1, "Antonio", 1), pao(2, "Bruno", 20)],
      new Map([[1, new Set(["T8"])], [2, new Set(["T8"])]]),
    );
    const ws = new GenerationWorkspace(input);
    const ctx = ws.initRateioContext();
    const ordered = sortPaoByRateioPriority(
      ws,
      ctx,
      "T8",
      ws.paoEmps.map((c) => ({ uuid: c.uuid, seniority: c.employee.seniority })),
    );
    expect(ordered[0]!.uuid).toBe("pao-1");
  });
});

describe("preferência respeita limites de rateio", () => {
  it("canAssignShiftWithRateio bloqueia acima do max mesmo com preferência", () => {
    const r = canAssignShiftWithRateio({
      monthDays: 31,
      day: 1,
      shift: "T7",
      employeeId: "pao-1",
      currentTurnCounts: new Map([["pao-1", 12]]),
      maxTurnCounts: new Map([["pao-1", 12]]),
      preferredShiftByEmployee: new Map([["pao-1", "T7"]]),
      seniorityWeightByEmployee: new Map([["pao-1", 1.5]]),
    });
    expect(r.allowed).toBe(false);
  });

  it("preferência não altera elegibilidade de rateio (max continua bloqueando)", () => {
    const senior = canAssignShiftWithRateio({
      monthDays: 31,
      day: 1,
      shift: "T7",
      employeeId: "pao-1",
      currentTurnCounts: new Map([["pao-1", 5], ["pao-2", 5]]),
      maxTurnCounts: new Map([["pao-1", 12], ["pao-2", 12]]),
      preferredShiftByEmployee: new Map([
        ["pao-1", "T7"],
        ["pao-2", "T7"],
      ]),
      seniorityWeightByEmployee: new Map([
        ["pao-1", 1.5],
        ["pao-2", 1.0],
      ]),
    });
    const junior = canAssignShiftWithRateio({
      monthDays: 31,
      day: 1,
      shift: "T7",
      employeeId: "pao-2",
      currentTurnCounts: new Map([["pao-1", 5], ["pao-2", 5]]),
      maxTurnCounts: new Map([["pao-1", 12], ["pao-2", 12]]),
      preferredShiftByEmployee: new Map([
        ["pao-1", "T7"],
        ["pao-2", "T7"],
      ]),
      seniorityWeightByEmployee: new Map([
        ["pao-1", 1.5],
        ["pao-2", 1.0],
      ]),
    });
    expect(senior.allowed).toBe(true);
    expect(junior.allowed).toBe(true);
    expect(senior.scorePenalty).toBeLessThan(junior.scorePenalty);
  });
});

describe("auditoria preferência x senioridade", () => {
  it("formata tabela com percentual de atendimento", () => {
    const input = minimalInput([pao(1, "Antonio", 3)], new Map([[1, new Set(["T7"])]]));
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.planned.set("1|2026-07-01", "T7");
    ws.planned.set("1|2026-07-02", "T7");
    ws.planned.set("1|2026-07-03", "T6");
    ws.initRateioContext();
    const rows = buildPreferenceSeniorityAudit(ws, ws.rateioContext!);
    const text = formatPreferenceSeniorityAudit(rows);
    expect(text).toContain("PREFERÊNCIA X SENIORIDADE");
    expect(text).toContain("Antonio");
    expect(rows[0]!.preferredReceived).toBe(2);
    expect(rows[0]!.preferredPossible).toBe(3);
    expect(rows[0]!.attendancePercent).toBe(67);
  });

  it("resume quartis de atendimento por senioridade", () => {
    const input = minimalInput(
      [pao(1, "Antonio", 1), pao(2, "Bruno", 2), pao(3, "Carlos", 3), pao(4, "Diego", 4)],
      new Map([
        [1, new Set(["T7"])],
        [2, new Set(["T7"])],
        [3, new Set(["T7"])],
        [4, new Set(["T7"])],
      ]),
    );
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.planned.set("1|2026-07-01", "T7");
    ws.planned.set("1|2026-07-02", "T7");
    ws.planned.set("2|2026-07-03", "T7");
    ws.planned.set("4|2026-07-04", "T6");
    ws.initRateioContext();
    const rows = buildPreferenceSeniorityAudit(ws, ws.rateioContext!);
    const q = buildPreferenceQuartileSummary(rows);
    expect(q.sampleSize).toBe(4);
    expect(q.superior).toBeGreaterThanOrEqual(q.inferior);
    const text = formatPreferenceSeniorityAudit(rows);
    expect(text).toContain("Quartil superior");
  });
});
