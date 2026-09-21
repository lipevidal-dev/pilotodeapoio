import { describe, expect, it } from "vitest";
import { generateCleanSchedule } from "../domain/schedule/clean-engine/clean-engine.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import { paoShiftParamId } from "../domain/schedule/next-motor/next-motor-shift-params.js";
import type { GenerationInput, GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import type { Employee } from "../domain/employee/types.js";
import type { Shift } from "../domain/shift/types.js";

function emp(id: number, name: string): GenerationInputEmployee {
  const employee: Employee = { id, name, role: "PAO", seniority: id };
  return { uuid: `uuid-${id}`, domainId: id, employee };
}

function shifts(): Shift[] {
  return [
    { code: "T6", startTime: "06:00", endTime: "14:00", role: "PAO", active: true },
    { code: "T7", startTime: "14:00", endTime: "22:00", role: "PAO", active: true },
    { code: "T8", startTime: "22:00", endTime: "06:00", role: "PAO", active: true },
  ];
}

/**
 * Mono real = bloco de 1 dia no mês SEM spillover cross-month
 * (30/11 + 01–02/12 conta como bloco 3, não mono).
 */
function countTrueMonoBlocks(
  assignments: Array<{ employeeUuid: string; date: string; shiftCode: string }>,
  spillover: Array<{ employeeUuid: string; date: string; label: string }>,
  shiftCode: string,
): number {
  const byEmp = new Map<string, string[]>();
  for (const a of assignments) {
    if (a.shiftCode.toUpperCase() !== shiftCode) continue;
    const list = byEmp.get(a.employeeUuid) ?? [];
    list.push(a.date);
    byEmp.set(a.employeeUuid, list);
  }
  for (const s of spillover) {
    if (s.label.toUpperCase() !== shiftCode) continue;
    const list = byEmp.get(s.employeeUuid) ?? [];
    list.push(s.date);
    byEmp.set(s.employeeUuid, list);
  }
  let monos = 0;
  for (const dates of byEmp.values()) {
    const sorted = [...new Set(dates)].sort();
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (
        j + 1 < sorted.length &&
        Date.parse(sorted[j + 1]!) - Date.parse(sorted[j]!) === 86_400_000
      ) {
        j++;
      }
      if (j - i + 1 === 1) monos++;
      i = j + 1;
    }
  }
  return monos;
}

describe("EXTRA_COBERTURA sem mono turno T6/T7", () => {
  it("não fecha gaps com dia isolado — só bloco do agrupamento (spillover ok)", () => {
    // 4 PAOs, só T6, nov 30d → demanda 30, meta floor(30/4)=7, resto 2.
    const paos = [1, 2, 3, 4].map((i) => emp(i, `P${i}`));
    const prior = new Map(paos.map((p, idx) => [p.uuid, idx === 0 ? 10 : 50]));
    const input: GenerationInput = {
      year: 2026,
      month: 11,
      employees: paos,
      shifts: shifts(),
      lockedAllocations: [],
      vacationDays: [],
      approvedDayOff: [],
      flightDays: [],
      yearRateioPriorCounts: prior,
      preferredShifts: new Map(paos.map((p) => [p.domainId, new Set(["T6"])])),
    };
    const result = generateCleanSchedule(input, {
      motorVersion: MOTOR_VERSION_NEXT,
      coverageShiftCodes: ["T6"],
      scopeEmployeeUuids: paos.map((p) => p.uuid),
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
        [paoShiftParamId("agrupamento_turnos", "T6")]: 3,
        [paoShiftParamId("max_consecutivos", "T6")]: 6,
      },
    });

    const monos = countTrueMonoBlocks(
      result.assignments,
      result.crossMonthPreAllocations ?? [],
      "T6",
    );
    expect(monos).toBe(0);

    // Resto < agrupamento pode ficar como gap (preferível a mono).
    expect(typeof result.summary.coverageGaps).toBe("number");
  });
});
