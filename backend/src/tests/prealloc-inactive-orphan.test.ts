import { describe, expect, it } from "vitest";
import { generateScheduleClean } from "../domain/schedule/clean-engine/clean-adapter.js";
import {
  filterPersistenceBlockingIssues,
  validateCleanGenerationBeforeSave,
  validatePreAllocationsPreserved,
} from "../domain/schedule/clean-engine/clean-validator.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import type { CleanEngineOptions } from "../domain/schedule/clean-engine/clean-types.js";
import { filterLockedAllocationsForEmployees } from "../infrastructure/mappers/generation-input.mapper.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const opts: CleanEngineOptions = { motorVersion: MOTOR_VERSION_NEXT };

describe("pré-alocações órfãs / inativos", () => {
  it("filterLockedAllocationsForEmployees remove UUID fora do elenco ativo", () => {
    const locks = [
      { employeeUuid: "real-1", date: "2026-11-01", label: "FOLGA" },
      { employeeUuid: "inactive-orphan", date: "2026-11-01", label: "FOLGA" },
    ];
    const filtered = filterLockedAllocationsForEmployees(locks, ["real-1", "real-2"]);
    expect(filtered).toEqual([{ employeeUuid: "real-1", date: "2026-11-01", label: "FOLGA" }]);
  });

  it("validatePreAllocationsPreserved ignora FOLGA de funcionário inativo/órfão", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 11,
      lockedAllocations: [
        { employeeUuid: "inactive-orphan", date: "2026-11-01", label: "FOLGA" },
        { employeeUuid: "real-1", date: "2026-11-01", label: "FOLGA" },
      ],
    });
    const issues = validatePreAllocationsPreserved(
      input,
      [],
      [{ employeeUuid: "real-1", date: "2026-11-01", label: "FOLGA" }],
    );
    expect(issues.some((i) => i.employee === "inactive-orphan")).toBe(false);
    expect(issues.filter((i) => i.type === "PREALLOC_ALLOC_MISSING")).toHaveLength(0);
  });

  it("geração Nov com FOLGA cross-month de inativo não bloqueia persistência", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 11,
      lockedAllocations: [
        { employeeUuid: "inactive-orphan", date: "2026-11-01", label: "FOLGA" },
        { employeeUuid: "real-1", date: "2026-11-01", label: "FOLGA" },
      ],
      crossMonthHistory: {
        assignments: [
          { employeeUuid: "real-1", date: "2026-10-26", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-27", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-28", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-29", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-30", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-31", shiftCode: "T7" },
        ],
        allocations: [],
      },
    });
    const activeLocks = filterLockedAllocationsForEmployees(
      input.lockedAllocations,
      input.employees.map((e) => e.uuid),
    );
    const filteredInput = { ...input, lockedAllocations: activeLocks };
    const result = generateScheduleClean(filteredInput, opts);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === "real-1" && a.date === "2026-11-01" && a.label === "FOLGA",
      ),
    ).toBe(true);
    const validation = validateCleanGenerationBeforeSave(filteredInput, result, opts);
    const blockers = filterPersistenceBlockingIssues(validation.issues, opts);
    expect(blockers.some((i) => i.type === "PREALLOC_ALLOC_MISSING")).toBe(false);
  });

  it("6x1: 6 turnos no fim de outubro impõem FOLGA em 01/11", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 11,
      crossMonthHistory: {
        assignments: [
          { employeeUuid: "real-1", date: "2026-10-26", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-27", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-28", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-29", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-30", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-31", shiftCode: "T7" },
        ],
        allocations: [],
      },
    });
    const result = generateScheduleClean(input, opts);
    expect(
      result.allocations.some(
        (a) => a.employeeUuid === "real-1" && a.date === "2026-11-01" && a.label === "FOLGA",
      ),
    ).toBe(true);
    expect(
      result.assignments.some((a) => a.employeeUuid === "real-1" && a.date === "2026-11-01"),
    ).toBe(false);
  });
});
