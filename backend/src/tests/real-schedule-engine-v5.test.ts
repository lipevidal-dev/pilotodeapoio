import { describe, expect, it } from "vitest";
import { addDays } from "../domain/rules/dates.js";
import { FANI_LABEL } from "../domain/rules/birthday.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realScheduleEngineV5 } from "../domain/schedule/real-schedule-engine-v5.js";
import { realScheduleEngineV4 } from "../domain/schedule/real-schedule-engine-v4.js";
import { resolveScheduleEngineVersion } from "../domain/schedule/schedule-engine-config.js";
import { generateScheduleWithRouter } from "../domain/schedule/schedule-engine-router.js";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { expandSpecificShiftRequests } from "../domain/schedule/specific-shift-requests.js";
import {
  v5AllocateBySeniorityQuota,
  v5AllocatePreferredTurnsBySeniority,
} from "../domain/schedule/v5-quota-allocation.js";
import { applyFaniFollowingFolga, applySpecificShiftRequests } from "../domain/schedule/v5-audit.js";
import { assignmentKey } from "../domain/schedule/types.js";
import { MOTOR_VERSION_V5, MOTOR_VERSION_V6 } from "../domain/schedule/real-schedule-types.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import { realPaoUuid } from "./schedule-slices/slice-helpers.js";

const engine = new ScheduleGenerationEngine();
const v5 = realScheduleEngineV5;

function paoEmployees(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    uuid: realPaoUuid(i),
    domainId: i + 1,
    employee: {
      id: i + 1,
      name: `PAO ${i + 1}`,
      role: "PAO" as const,
      seniority: i + 1,
    },
  }));
}

describe("Motor V5 — cota, senioridade e preferências", () => {
  it("1. router usa V5 por padrão", () => {
    expect(resolveScheduleEngineVersion({ SCHEDULE_ENGINE_VERSION: undefined })).toBe("V6");
    expect(resolveScheduleEngineVersion({ SCHEDULE_ENGINE_VERSION: "V5" })).toBe("V5");
    expect(resolveScheduleEngineVersion({ SCHEDULE_ENGINE_VERSION: "V4" })).toBe("V4");
  });

  it("2. V4 backup intacto (REAL_V4)", () => {
    const input = realisticGenerationInput({ month: 7 });
    const result = realScheduleEngineV4.generate(input);
    expect(result.summary.motorVersion).toBe("REAL_V4");
    expect(result.summary.realEngineExecuted).toBe(true);
  });

  it("3. V5 reporta REAL_V5", () => {
    const result = v5.generate(realisticGenerationInput({ month: 7 }));
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_V5);
    expect(result.summary.enginePath).toContain("V5");
  });

  it("4. senioridade influencia ordem de cota (mais antigo recebe turnos primeiro)", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(4),
    });
    const result = v5.generate(input);
    const turns = new Map<string, number>();
    for (const a of result.assignments) {
      if (["T6", "T7", "T8", "T9"].includes(a.shiftCode)) {
        turns.set(a.employeeUuid, (turns.get(a.employeeUuid) ?? 0) + 1);
      }
    }
    const senior = [...input.employees].sort(
      (a, b) => a.employee.seniority - b.employee.seniority,
    );
    const first = turns.get(senior[0].uuid) ?? 0;
    const last = turns.get(senior[senior.length - 1].uuid) ?? 0;
    expect(first).toBeGreaterThanOrEqual(last);
  });

  it("5. preferência T8 recebe prioridade real", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(4),
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    });
    const result = v5.generate(input);
    const t8ForPref = result.assignments.filter(
      (a) => a.employeeUuid === realPaoUuid(0) && a.shiftCode === "T8",
    ).length;
    expect(t8ForPref).toBeGreaterThan(0);
  });

  it("5b. senior com pref T8 tem atendimento >= junior após geração completa", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(2),
      preferredShifts: new Map([
        [1, new Set(["T8"])],
        [2, new Set(["T8"])],
      ]),
    });
    const result = v5.generate(input);
    const seniorUuid = realPaoUuid(0);
    const juniorUuid = realPaoUuid(1);

    const stats = (uuid: string) => {
      const turns = result.assignments.filter(
        (a) => a.employeeUuid === uuid && ["T6", "T7", "T8", "T9"].includes(a.shiftCode),
      );
      const t8 = turns.filter((a) => a.shiftCode === "T8").length;
      return { total: turns.length, t8, pct: turns.length > 0 ? (t8 / turns.length) * 100 : 0 };
    };

    const senior = stats(seniorUuid);
    const junior = stats(juniorUuid);
    expect(senior.t8).toBeGreaterThan(0);
    expect(senior.pct).toBeGreaterThanOrEqual(junior.pct);
  });

  it("5c. pref T6 recebe T6 na fase preferida antes de outros turnos", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(6),
      preferredShifts: new Map([
        [5, new Set(["T6"])],
        [6, new Set(["T6"])],
      ]),
    });
    const ws = new GenerationWorkspace(input);
    ws.realV1ManualCommonFolga = true;
    ws.applyHardBlocks();
    ws.initRateioContext();
    v5AllocatePreferredTurnsBySeniority(ws, []);
    ws.syncRateioContext();

    const juniorT6Pref = realPaoUuid(5);
    const t6Count = ws.toAssignments().filter(
      (a) => a.employeeUuid === juniorT6Pref && a.shiftCode === "T6",
    ).length;
    expect(t6Count).toBeGreaterThan(0);
  });

  it("6. PAO sem preferência T8 pode ficar com 0 T8 antes do reparo de cobertura", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(4),
      preferredShifts: new Map([[1, new Set(["T8"])]]),
    });
    const ws = new GenerationWorkspace(input);
    ws.realV1ManualCommonFolga = true;
    ws.applyHardBlocks();
    ws.initRateioContext();
    v5AllocateBySeniorityQuota(ws, []);
    ws.syncRateioContext();
    const noPrefUuid = realPaoUuid(3);
    const t8BeforeRepair = [...ws.toAssignments()].filter(
      (a) => a.employeeUuid === noPrefUuid && a.shiftCode === "T8",
    ).length;
    expect(t8BeforeRepair).toBe(0);
  });

  it("7. mono-turno é permitido", () => {
    const input = realisticGenerationInput({ month: 7, employees: paoEmployees(6) });
    const result = v5.generate(input);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    for (const a of result.assignments) {
      const did = ws.uuidToDomain.get(a.employeeUuid);
      if (did == null) continue;
      ws.planned.set(`${did}|${a.date}`, a.shiftCode);
    }
    let monoFound = false;
    for (const c of ws.paoEmps) {
      for (const day of ws.days) {
        const prev = addDays(day, -1);
        const next = addDays(day, 1);
        const did = c.domainId;
        const onDay = ws.planned.get(`${did}|${day}`);
        if (!onDay || !["T6", "T7"].includes(onDay)) continue;
        const prevSame = ws.planned.get(`${did}|${prev}`) === onDay;
        const nextSame = ws.planned.get(`${did}|${next}`) === onDay;
        if (!prevSame && !nextSame) monoFound = true;
      }
    }
    expect(monoFound).toBe(true);
  });

  it("8. alocação em dia específico funciona", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(4),
      specificShiftRequests: [
        { employeeUuid: realPaoUuid(0), date: "2026-07-10", shiftCode: "T7" },
      ],
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.initRateioContext();
    const warnings: import("../domain/schedule/types.js").ValidationIssue[] = [];
    applySpecificShiftRequests(ws, warnings);
    expect(warnings.length).toBe(0);
    expect(
      ws.toAssignments().some(
        (a) => a.employeeUuid === realPaoUuid(0) && a.date === "2026-07-10" && a.shiftCode === "T7",
      ),
    ).toBe(true);
  });

  it("9. alocação em dia específico inviável gera warning", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(4),
      vacationDays: [{ employeeUuid: realPaoUuid(0), date: "2026-07-10" }],
      specificShiftRequests: [
        { employeeUuid: realPaoUuid(0), date: "2026-07-10", shiftCode: "T7" },
      ],
    });
    const result = v5.generate(input);
    expect(result.violations.some((v) => v.type === "SPECIFIC_SHIFT_REQUEST_NOT_APPLIED")).toBe(true);
  });

  it("10. FANI gera folga no dia seguinte quando viável (V5)", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(4).map((e, i) =>
        i === 0
          ? { ...e, employee: { ...e.employee, birthDate: "1985-07-05" } }
          : e,
      ),
    });
    const result = v5.generate(input);
    expect(
      result.allocations.some(
        (a) =>
          a.employeeUuid === realPaoUuid(0) &&
          a.date === "2026-07-05" &&
          a.label === FANI_LABEL,
      ),
    ).toBe(true);
    expect(
      result.allocations.some(
        (a) =>
          a.employeeUuid === realPaoUuid(0) &&
          a.date === "2026-07-06" &&
          a.label === "FOLGA",
      ),
    ).toBe(true);
  });

  it("11. FANI não sobrescreve pré-alocação locked no dia seguinte", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: paoEmployees(1),
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.lockDay(realPaoUuid(0), "2026-07-05", FANI_LABEL);
    ws.lockDay(realPaoUuid(0), "2026-07-06", "CURSO", true);
    const warnings: import("../domain/schedule/types.js").ValidationIssue[] = [];
    applyFaniFollowingFolga(ws, warnings);
    expect(warnings.some((w) => w.type === "FANI_FOLLOWING_DAY_OFF_NOT_APPLIED")).toBe(true);
    const did = ws.uuidToDomain.get(realPaoUuid(0));
    expect(did != null && ws.blocked.get(assignmentKey(did, "2026-07-06")) === "CURSO").toBe(true);
  });

  it("12. expandSpecificShiftRequests — weekday segunda-feira", () => {
    const days = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const expanded = expandSpecificShiftRequests(2026, 7, days, [
      { employeeUuid: "x", shiftCode: "T6", weekday: 1 },
    ]);
    expect(expanded.every((r) => new Date(`${r.date}T12:00:00`).getDay() === 1)).toBe(true);
    expect(expanded.length).toBeGreaterThan(0);
  });

  it("13. ScheduleGenerationEngine usa V6 por padrão", () => {
    const result = engine.generate(realisticGenerationInput({ month: 7 }));
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_V6);
  });

  it("14. julho/2026 realistic — gera escala V5 sem exceção", () => {
    const input = realisticGenerationInput({ month: 7 });
    const result = generateScheduleWithRouter(input, {
      SCHEDULE_ENGINE_VERSION: "V5",
      SCHEDULE_ENGINE_FALLBACK_V4: "false",
    });
    expect(result.summary.motorVersion).toBe(MOTOR_VERSION_V5);
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.summary.coverageGaps).toBeLessThanOrEqual(3);
  });

  it("15. pool PAO ignora APAO na ordenação de cota", () => {
    const paos = paoEmployees(4);
    const ws = new GenerationWorkspace(
      realisticGenerationInput({
        month: 7,
        employees: [
          { uuid: "apao-x", domainId: 99, employee: { id: 99, name: "APAO X", role: "APAO", seniority: 1 } },
          ...paos,
        ],
      }),
    );
    ws.initRateioContext();
    const ctx = ws.rateioContext!;
    expect(ctx.paoPoolSeniorityByEmployee.size).toBe(4);
    expect(ctx.paoPoolSeniorityByEmployee.has("apao-x")).toBe(false);
    expect(ctx.paoPoolSeniorityByEmployee.get(realPaoUuid(0))?.poolRank).toBe(1);
  });
});
