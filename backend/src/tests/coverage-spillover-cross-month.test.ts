import { describe, expect, it } from "vitest";
import { CleanWorkspace } from "../domain/schedule/clean-engine/clean-workspace.js";
import {
  blockDatesWithSpillover,
  sortCandidatesByFairRateioDebt,
  tryFillCoverageBlock,
} from "../domain/schedule/clean-engine/clean-preferences.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import { paoShiftParamId } from "../domain/schedule/next-motor/next-motor-shift-params.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";

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

/** Novembro 2026 = 30 dias — bloco de 5 a partir do dia 28 precisa spillover. */
function novInput(paos: GenerationInputEmployee[]): GenerationInput {
  return {
    year: 2026,
    month: 11,
    employees: paos,
    shifts: shifts(),
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
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
      max_6_consecutive: true,
    },
    motorParams: {
      pao_meta_turnos: 20,
      pao_espacamento_turnos: 0,
      pao_max_consecutivos: 6,
      [paoShiftParamId("agrupamento_turnos", "T6")]: 5,
      [paoShiftParamId("agrupamento_turnos", "T7")]: 5,
      [paoShiftParamId("espacamento", "T6")]: 0,
      [paoShiftParamId("espacamento", "T7")]: 0,
      [paoShiftParamId("max_consecutivos", "T6")]: 6,
      [paoShiftParamId("max_consecutivos", "T7")]: 6,
    },
    ...extra,
  };
}

describe("cobertura spillover cross-month", () => {
  it("blockDatesWithSpillover: 28/11 + bloco 5 → 28-30 + 01-02/12", () => {
    const paos = [emp(1, "Ana"), emp(2, "Bruno")];
    const ws = new CleanWorkspace(novInput(paos), nextOpts({ scopeEmployeeUuids: paos.map((p) => p.uuid) }));
    const resolved = blockDatesWithSpillover(ws, "2026-11-28", 5);
    expect(resolved).not.toBeNull();
    expect(resolved!.inMonth).toEqual(["2026-11-28", "2026-11-29", "2026-11-30"]);
    expect(resolved!.spillover).toEqual(["2026-12-01", "2026-12-02"]);
  });

  it("fecha gap T6 no fim do mês com spillover e rateio justo (maior dívida primeiro)", () => {
    const lowDebt = emp(1, "QuaseCheio", 1);
    const highDebt = emp(2, "BemAbaixo", 2);
    lowDebt.uuid = "uuid-low";
    highDebt.uuid = "uuid-high";
    const paos = [lowDebt, highDebt];
    const input = novInput(paos);
    const opts = nextOpts({ scopeEmployeeUuids: ["uuid-low", "uuid-high"] });
    const ws = new CleanWorkspace(input, opts);

    // PAO com pouca dívida: vários T6 no início.
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
      expect(ws.tryAssign("uuid-low", d, "T6", "SEED")).toBe(true);
    }
    expect(ws.tryAssign("uuid-high", "2026-11-10", "T6", "SEED")).toBe(true);

    // Impede bloco 100% no mês (26–30): cobre 26–27 para forçar start em 28 + spillover.
    expect(ws.tryAssign("uuid-low", "2026-11-26", "T6", "SEED")).toBe(true);
    expect(ws.tryAssign("uuid-low", "2026-11-27", "T6", "SEED")).toBe(true);

    const sorted = sortCandidatesByFairRateioDebt(ws, ws.paoEmployees, "T6");
    expect(sorted[0]!.uuid).toBe("uuid-high");

    const gap = "2026-11-28";
    expect(ws.hasPaoCoverage(gap, "T6")).toBe(false);
    expect(tryFillCoverageBlock(ws, gap, "T6", "COVERAGE", ws.paoEmployees)).toBe(true);

    expect(ws.getShiftOnDay(highDebt.domainId, "2026-11-28")?.toUpperCase()).toBe("T6");
    expect(ws.getShiftOnDay(highDebt.domainId, "2026-11-29")?.toUpperCase()).toBe("T6");
    expect(ws.getShiftOnDay(highDebt.domainId, "2026-11-30")?.toUpperCase()).toBe("T6");
    expect(ws.getShiftOnDay(lowDebt.domainId, "2026-11-28")).toBeUndefined();

    expect(
      ws.crossMonthPreAllocations.some(
        (r) => r.employeeUuid === "uuid-high" && r.date === "2026-12-01" && r.label === "T6",
      ),
    ).toBe(true);
    expect(
      ws.crossMonthPreAllocations.some(
        (r) => r.employeeUuid === "uuid-high" && r.date === "2026-12-02" && r.label === "T6",
      ),
    ).toBe(true);

    expect(
      ws.audit.all().some(
        (e) => e.kind === "COVERAGE_ASSIGNED" && e.reason.includes("spillover cross-month"),
      ),
    ).toBe(true);
  });

  it("fillCoverageGaps no fim do mês fecha T7 com spillover", () => {
    const a = emp(1, "Ana", 1);
    const b = emp(2, "Bruno", 2);
    a.uuid = "uuid-a";
    b.uuid = "uuid-b";
    const input: GenerationInput = {
      ...novInput([a, b]),
      preferredShifts: new Map([
        [1, new Set(["T6"])],
        [2, new Set(["T6"])],
      ]),
    };
    const ws = new CleanWorkspace(
      input,
      nextOpts({
        scopeEmployeeUuids: ["uuid-a", "uuid-b"],
        coverageShiftCodes: ["T7"],
        enabledRules: {
          preferred_shifts: true,
          pao_meta_turnos: false,
          pao_espacamento_turnos: true,
          pao_meta_dias_trabalhados: false,
          coverage_t7: true,
          max_6_consecutive: true,
        },
      }),
    );

    // Cobre 1–27 sem deixar Ana/Bruno com consecutivos colados em 28.
    const seeds: Array<{ uuid: string; days: string[] }> = [
      { uuid: "uuid-a", days: ["01", "02", "03", "04", "05"] },
      { uuid: "uuid-b", days: ["06", "07", "08", "09", "10"] },
      { uuid: "uuid-a", days: ["11", "12", "13", "14", "15"] },
      { uuid: "uuid-b", days: ["16", "17", "18", "19", "20"] },
      { uuid: "uuid-a", days: ["21", "22", "23"] },
      { uuid: "uuid-b", days: ["24", "25"] },
      { uuid: "uuid-a", days: ["26", "27"] },
    ];
    for (const block of seeds) {
      for (const dd of block.days) {
        expect(ws.tryAssign(block.uuid, `2026-11-${dd}`, "T7", "SEED")).toBe(true);
      }
    }

    expect(ws.hasPaoCoverage("2026-11-27", "T7")).toBe(true);
    expect(ws.hasPaoCoverage("2026-11-28", "T7")).toBe(false);

    ws.fillCoverageGaps();

    for (const d of ["2026-11-28", "2026-11-29", "2026-11-30"]) {
      expect(ws.hasPaoCoverage(d, "T7")).toBe(true);
    }

    const spill = ws.crossMonthPreAllocations.filter((r) => r.label.toUpperCase() === "T7");
    expect(spill.map((r) => r.date).sort()).toEqual(["2026-12-01", "2026-12-02"]);
  });
});
