import { describe, expect, it } from "vitest";
import {
  MIN_RATEIO_BLOCK_SIZE,
  agrupamentoMinForShift,
  minimumBlockSizeForShift,
  requiredBlockSizeForShift,
} from "../domain/schedule/clean-engine/clean-block-rules.js";
import { tryPlacePreferredBlock } from "../domain/schedule/clean-engine/clean-preferences.js";
import { CleanWorkspace } from "../domain/schedule/clean-engine/clean-workspace.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";
import { paoShiftParamId } from "../domain/schedule/next-motor/next-motor-shift-params.js";

function emp(id: number, name: string): GenerationInputEmployee {
  const employee: Employee = { id, name, role: "PAO", seniority: id };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function baseShifts(): Shift[] {
  return [
    { code: "T6", startTime: "06:00", endTime: "14:00", role: "PAO", active: true },
  ];
}

function baseInput(paos: GenerationInputEmployee[]): GenerationInput {
  return {
    year: 2026,
    month: 7,
    employees: paos,
    shifts: baseShifts(),
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
  };
}

describe("clean-block-rules", () => {
  it("T6/T7 exigem bloco mínimo de 3; T8/T9 permanecem unitários", () => {
    expect(MIN_RATEIO_BLOCK_SIZE).toBe(3);
    expect(minimumBlockSizeForShift("T6")).toBe(3);
    expect(minimumBlockSizeForShift("T7")).toBe(3);
    expect(minimumBlockSizeForShift("T8")).toBe(1);
    expect(minimumBlockSizeForShift("T9")).toBe(1);
    expect(agrupamentoMinForShift("T6")).toBe(3);
  });

  it("agrupamento 5 eleva o bloco exigido para 5", () => {
    expect(requiredBlockSizeForShift("T6", 5)).toBe(5);
  });
});

describe("tryPlacePreferredBlock — agrupamento configurado", () => {
  it("não aloca bloco menor que o agrupamento (5)", () => {
    const input = baseInput([emp(1, "Ana")]);
    const ws = new CleanWorkspace(input, {
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6"],
      scopeEmployeeUuids: ["uuid-1"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
      },
      motorParams: {
        [paoShiftParamId("agrupamento_turnos", "T6")]: 5,
        [paoShiftParamId("meta_turnos", "T6")]: 10,
      },
    });
    const empRow = ws.paoEmployees[0]!;
    const placed = tryPlacePreferredBlock(ws, empRow, "T6", "2026-07-01", 3, 0, "TEST", 5);
    expect(placed).toBe(0);
  });

  it("aloca bloco de 5 dias quando há janela livre", () => {
    const input = baseInput([emp(1, "Ana")]);
    const ws = new CleanWorkspace(input, {
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6"],
      scopeEmployeeUuids: ["uuid-1"],
      enabledRules: {
        preferred_shifts: true,
        pao_meta_turnos: true,
        pao_espacamento_turnos: true,
      },
      motorParams: {
        [paoShiftParamId("agrupamento_turnos", "T6")]: 5,
        [paoShiftParamId("meta_turnos", "T6")]: 10,
      },
    });
    const empRow = ws.paoEmployees[0]!;
    const placed = tryPlacePreferredBlock(ws, empRow, "T6", "2026-07-01", 5, 0, "TEST", 5);
    expect(placed).toBe(5);
    expect(
      ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"].every(
        (d) => ws.getShiftOnDay(1, d)?.toUpperCase() === "T6",
      ),
    ).toBe(true);
  });
});
