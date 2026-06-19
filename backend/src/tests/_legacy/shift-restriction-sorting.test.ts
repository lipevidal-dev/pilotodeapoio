import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import { buildShiftRestrictionMap } from "../infrastructure/mappers/generation-input.mapper.js";
import { sortPaoForCoverageCandidates } from "../domain/schedule/real-schedule-turn-rateio.js";
import { sortPaoForT8CoverageCandidates } from "../domain/schedule/t8-coverage-priority.js";
import {
  isEmployeeShiftRestricted,
  sortCandidatesForRestrictedShiftBreak,
} from "../domain/schedule/shift-restriction-sorting.js";
import { RealScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { validateGenerationBeforeSave } from "../domain/schedule/schedule-generation-validators.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

function pao(
  id: number,
  name: string,
  seniority: number,
): GenerationInputEmployee {
  return {
    uuid: `pao-${id}`,
    domainId: id,
    employee: { id, name, role: "PAO", seniority },
  };
}

function inputWithPaos(
  paos: GenerationInputEmployee[],
  restrictions: Array<{ employeeUuid: string; shiftCode: string }> = [],
): GenerationInput {
  return {
    year: 2026,
    month: 6,
    employees: [
      ...paos,
      {
        uuid: "apao-1",
        domainId: 100,
        employee: { id: 100, name: "APAO 1", role: "APAO", seniority: 1 },
      },
    ],
    shifts: [
      { code: "T6", name: "T6", role: "PAO", active: true, startTime: "06:00", endTime: "14:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T7", name: "T7", role: "PAO", active: true, startTime: "14:00", endTime: "22:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
      { code: "T8", name: "T8", role: "PAO", active: true, startTime: "22:00", endTime: "06:00", minStaff: 1, maxStaff: 1, coverageType: "REQUIRED" },
    ],
    lockedAllocations: [],
    vacationDays: [],
    approvedDayOff: [],
    flightDays: [],
    shiftRestrictions: buildShiftRestrictionMap(paos, restrictions),
  };
}

describe("sortCandidatesForRestrictedShiftBreak", () => {
  it("candidato sem restrição vem antes dos restritos", () => {
    const paos = [pao(1, "Antigo", 1), pao(2, "Novo", 10)];
    const input = inputWithPaos(paos, [{ employeeUuid: "pao-1", shiftCode: "T8" }]);
    const ws = new GenerationWorkspace(input);
    const sorted = sortCandidatesForRestrictedShiftBreak(ws, paos, "T8");
    expect(sorted[0]!.uuid).toBe("pao-2");
    expect(sorted[1]!.uuid).toBe("pao-1");
  });

  it("entre restritos, ordena do mais novo para o mais antigo", () => {
    const paos = [pao(1, "A", 1), pao(2, "B", 5), pao(3, "C", 10)];
    const input = inputWithPaos(
      paos,
      paos.map((e) => ({ employeeUuid: e.uuid, shiftCode: "T8" })),
    );
    const ws = new GenerationWorkspace(input);
    const sorted = sortCandidatesForRestrictedShiftBreak(ws, paos, "T8");
    expect(sorted.map((c) => c.employee.seniority)).toEqual([10, 5, 1]);
  });

  it("sortPaoForCoverageCandidates coloca sem restrição T6 antes", () => {
    const paos = [pao(1, "Antigo", 1), pao(2, "Novo", 10)];
    const input = inputWithPaos(paos, [{ employeeUuid: "pao-1", shiftCode: "T6" }]);
    const ws = new GenerationWorkspace(input);
    ws.initRateioContext();
    const sorted = sortPaoForCoverageCandidates(ws, 0, undefined, "T6");
    expect(sorted[0]!.uuid).toBe("pao-2");
  });

  it("sortPaoForT8CoverageCandidates coloca sem restrição T8 antes", () => {
    const paos = [pao(1, "Antigo", 1), pao(2, "Novo", 10)];
    const input = inputWithPaos(paos, [{ employeeUuid: "pao-1", shiftCode: "T8" }]);
    const ws = new GenerationWorkspace(input);
    ws.initRateioContext();
    const sorted = sortPaoForT8CoverageCandidates(ws, 0, true);
    expect(sorted[0]!.uuid).toBe("pao-2");
  });
});

describe("restrição de turno — quebra por senioridade inversa", () => {
  it("restrição bloqueia alocação normal", () => {
    const paos = [pao(1, "A", 1)];
    const input = inputWithPaos(paos, [{ employeeUuid: "pao-1", shiftCode: "T8" }]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift("pao-1", "2026-06-10", "T8")).toBe(false);
    expect(isEmployeeShiftRestricted(ws, "pao-1", "T8")).toBe(true);
  });

  it("cobertura emergencial quebra restrição no mais novo primeiro", () => {
    const paos = [pao(1, "Antigo", 1), pao(2, "Novo", 10)];
    const input = inputWithPaos(
      paos,
      paos.map((e) => ({ employeeUuid: e.uuid, shiftCode: "T8" })),
    );
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();

    const sorted = sortCandidatesForRestrictedShiftBreak(ws, paos, "T8");
    let assigned: string | undefined;
    for (const c of sorted) {
      if (ws.tryAssignShift(c.uuid, "2026-06-12", "T8", true)) {
        assigned = c.uuid;
        break;
      }
    }
    expect(assigned).toBe("pao-2");
  });

  it("canWork permite restrição apenas em coverageEmergency", () => {
    const paos = [pao(1, "A", 1)];
    const input = inputWithPaos(paos, [{ employeeUuid: "pao-1", shiftCode: "T8" }]);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(ws.tryAssignShift("pao-1", "2026-06-10", "T8")).toBe(false);
    expect(ws.tryAssignShift("pao-1", "2026-06-10", "T8", true)).toBe(true);
  });
});

describe("restrição inversa — motor completo", () => {
  it("julho/2026 fixture: gaps=0 e validateBeforeSave OK", () => {
    const input = realisticGenerationInput({ year: 2026, month: 7 });
    const engine = new RealScheduleEngine();
    const result = engine.generate(input);
    expect(result.summary.coverageGaps ?? result.summary.coverageMissingCount ?? 0).toBe(0);
    const validation = validateGenerationBeforeSave(input, result);
    expect(validation.criticalCount).toBe(0);
  });
});
