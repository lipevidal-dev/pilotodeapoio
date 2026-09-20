import { describe, expect, it } from "vitest";
import { CleanWorkspace } from "../domain/schedule/clean-engine/clean-workspace.js";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import { paoShiftParamId } from "../domain/schedule/next-motor/next-motor-shift-params.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";
import {
  fairRateioExpectedYearToDate,
  fairRateioTargetPerEmployee,
  MAX_MONTHLY_RATEIO_OVERSHOOT,
  yearRateioSaldo,
} from "../domain/schedule/clean-engine/clean-fair-rateio.js";

function emp(id: number, name: string, seniority = id): GenerationInputEmployee {
  const employee: Employee = { id, name, role: "PAO", seniority };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function shifts(): Shift[] {
  return [
    { code: "T6", startTime: "06:00", endTime: "14:00", role: "PAO", active: true },
    { code: "T7", startTime: "14:00", endTime: "22:00", role: "PAO", active: true },
    { code: "T8", startTime: "22:00", endTime: "06:00", role: "PAO", active: true },
  ];
}

function novInput(
  paos: GenerationInputEmployee[],
  prior?: Map<string, number>,
): GenerationInput {
  return {
    year: 2026,
    month: 11,
    employees: paos,
    shifts: shifts(),
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    yearRateioPriorCounts: prior,
  };
}

function nextOpts(extra?: Record<string, unknown>) {
  return {
    motorVersion: MOTOR_VERSION_NEXT,
    coverageShiftCodes: ["T6", "T7", "T8"],
    enabledRules: {
      preferred_shifts: true,
      pao_meta_turnos: true,
      pao_espacamento_turnos: true,
      pao_meta_dias_trabalhados: false,
      coverage_t6: true,
      coverage_t7: true,
      coverage_t8: true,
      t8_t8_nd: true,
      max_6_consecutive: true,
    },
    motorParams: {
      pao_meta_turnos: 20,
      pao_espacamento_turnos: 0,
      [paoShiftParamId("agrupamento_turnos", "T6")]: 3,
      [paoShiftParamId("agrupamento_turnos", "T7")]: 3,
      [paoShiftParamId("espacamento", "T6")]: 0,
      [paoShiftParamId("espacamento", "T7")]: 0,
      [paoShiftParamId("espacamento", "T8")]: 0,
      [paoShiftParamId("max_consecutivos", "T6")]: 6,
      [paoShiftParamId("max_consecutivos", "T7")]: 6,
    },
    ...extra,
  };
}

describe("contador anual / saldo", () => {
  it("esperado YTD soma metas mensais justas", () => {
    // nov: 30d × 3 = 90; 12 PAOs → meta 7
    expect(fairRateioTargetPerEmployee(30, ["T6", "T7", "T8"], 12)).toBe(7);
    const ytd = fairRateioExpectedYearToDate(2026, 11, ["T6", "T7", "T8"], 12);
    expect(ytd).toBeGreaterThan(7 * 10);
    expect(yearRateioSaldo(60, 7, ytd)).toBe(60 + 7 - ytd);
  });

  it("MAX overshoot mensal é 2", () => {
    expect(MAX_MONTHLY_RATEIO_OVERSHOOT).toBe(2);
  });

  it("workspace: teto com overshoot e saldo prioriza quem está abaixo", () => {
    const low = emp(1, "Abaixo", 1);
    const high = emp(2, "Acima", 2);
    low.uuid = "uuid-low";
    high.uuid = "uuid-high";
    const prior = new Map([
      ["uuid-low", 40],
      ["uuid-high", 70],
    ]);
    const ws = new CleanWorkspace(
      novInput([low, high], prior),
      nextOpts({ scopeEmployeeUuids: ["uuid-low", "uuid-high"], coverageShiftCodes: ["T6"] }),
    );

    expect(ws.fairMonthlyMetaTurnos()).toBe(
      fairRateioTargetPerEmployee(30, ["T6"], 2),
    );
    expect(ws.yearRateioSaldo("uuid-low")).toBeLessThan(ws.yearRateioSaldo("uuid-high"));

    ws.metaOvershootAllowance = 0;
    const base = ws.effectiveTotalMetaForEmployee("uuid-low");
    ws.metaOvershootAllowance = 2;
    expect(ws.effectiveTotalMetaForEmployee("uuid-low")).toBe(base + 2);
  });

  it("EXTRA_COBERTURA: com prior baixo, permite ultrapassar meta justa em até +2", () => {
    // 2 PAOs, só T6, novembro 30 dias → demanda 30, meta floor(30/2)=15, resto 0.
    // Forçamos cenário com resto usando 3 PAOs: floor(30/3)=10, resto 0.
    // Melhor: 4 PAOs, T6 only → floor(30/4)=7, resto 2 — extras necessários.
    const paos = [1, 2, 3, 4].map((i) => {
      const e = emp(i, `P${i}`, i);
      e.uuid = `uuid-${i}`;
      return e;
    });
    // Quem tem menos acumulado (uuid-1) deve receber os extras.
    const prior = new Map([
      ["uuid-1", 10],
      ["uuid-2", 50],
      ["uuid-3", 50],
      ["uuid-4", 50],
    ]);
    const input: GenerationInput = {
      ...novInput(paos, prior),
      preferredShifts: new Map(paos.map((p) => [p.domainId, new Set(["T6"])])),
    };
    const result = generateCleanSchedule(
      input,
      nextOpts({
        scopeEmployeeUuids: paos.map((p) => p.uuid),
        coverageShiftCodes: ["T6"],
        enabledRules: {
          preferred_shifts: true,
          pao_meta_turnos: true,
          pao_espacamento_turnos: false,
          pao_meta_dias_trabalhados: false,
          coverage_t6: true,
          coverage_t7: false,
          coverage_t8: false,
          t8_t8_nd: false,
          max_6_consecutive: true,
        },
        motorParams: {
          [paoShiftParamId("agrupamento_turnos", "T6")]: 1,
          [paoShiftParamId("max_consecutivos", "T6")]: 6,
        },
      }),
    );

    const counts = new Map<string, number>();
    for (const a of result.assignments) {
      if (a.shiftCode.toUpperCase() !== "T6") continue;
      counts.set(a.employeeUuid, (counts.get(a.employeeUuid) ?? 0) + 1);
    }
    const c1 = counts.get("uuid-1") ?? 0;
    // Meta justa = 7; com EXTRA pode ir até 9. Quem tinha prior baixo deve estar >= meta.
    expect(c1).toBeGreaterThanOrEqual(7);
    expect(c1).toBeLessThanOrEqual(9);
    // Cobertura T6 deve fechar (resto 2 coberto pelos extras).
    const gapsT6 = result.summary.coverageGaps;
    expect(typeof gapsT6).toBe("number");
    // Com agrupamento 1 e EXTRA, esperamos 0 gaps de T6.
    const t6Gaps = [...Array(30)].filter((_, i) => {
      const d = `2026-11-${String(i + 1).padStart(2, "0")}`;
      return !result.assignments.some(
        (a) => a.date === d && a.shiftCode.toUpperCase() === "T6",
      );
    });
    expect(t6Gaps.length).toBe(0);
    expect(
      result.summary.realMotorReport &&
        (result.summary.realMotorReport as { stepNotes?: string[] }).stepNotes?.some((n) =>
          n.includes("EXTRA_COBERTURA"),
        ),
    ).toBeTruthy();
  });
});
