import type { Employee } from "../domain/employee/types.js";
import type { GenerationInput } from "../domain/schedule/generation-types.js";
import { iterDays } from "../domain/rules/dates.js";
import {
  REALISTIC_APAOS,
  REALISTIC_PAOS,
  REALISTIC_TEST_MONTH,
  REALISTIC_TEST_YEAR,
  realisticGenerationInput,
} from "./realistic-fixtures.js";

export { REALISTIC_TEST_YEAR, REALISTIC_TEST_MONTH };

const PAO_REDUCED: Employee[] = REALISTIC_PAOS.slice(0, 3);
const APAO_REDUCED: Employee[] = REALISTIC_APAOS.slice(0, 2);

function paoUuid(indexInRealistic: number): string {
  return `real-${REALISTIC_PAOS[indexInRealistic].id}`;
}

/** PAO Alpha — 15 primeiros dias de junho/2026 em férias. */
export function vacationSinglePao15DaysInput(): GenerationInput {
  const days = iterDays(REALISTIC_TEST_YEAR, REALISTIC_TEST_MONTH).slice(0, 15);
  return realisticGenerationInput({
    vacationDays: days.map((date) => ({ employeeUuid: paoUuid(0), date })),
  });
}

/** Alpha 1–15 e Bravo 10–20 (sobreposição 10–15). */
export function vacationTwoPaoOverlapInput(): GenerationInput {
  const all = iterDays(REALISTIC_TEST_YEAR, REALISTIC_TEST_MONTH);
  const alpha = all.slice(0, 15);
  const bravo = all.slice(9, 20);
  return realisticGenerationInput({
    vacationDays: [
      ...alpha.map((date) => ({ employeeUuid: paoUuid(0), date })),
      ...bravo.map((date) => ({ employeeUuid: paoUuid(1), date })),
    ],
  });
}

/** Três folgas pedidas (FP) para PAO Charlie. */
export function folgaPedidaThreeDaysInput(): GenerationInput {
  return realisticGenerationInput({
    approvedDayOff: [
      { employeeUuid: paoUuid(2), date: "2026-06-05" },
      { employeeUuid: paoUuid(2), date: "2026-06-12" },
      { employeeUuid: paoUuid(2), date: "2026-06-19" },
    ],
  });
}

/** VOO (voo), SIMULADOR e CURSO ONLINE como pré-alocações fixas. */
export function occupationBlocksInput(): GenerationInput {
  return realisticGenerationInput({
    lockedAllocations: [
      { employeeUuid: paoUuid(3), date: "2026-06-08", label: "VOO" },
      { employeeUuid: paoUuid(4), date: "2026-06-09", label: "SIMULADOR" },
      { employeeUuid: paoUuid(5), date: "2026-06-10", label: "CURSO ONLINE" },
    ],
    flightDays: [{ employeeUuid: paoUuid(3), date: "2026-06-08" }],
  });
}

/** 4 PAO + 2 APAO — cenário tipicamente inviável para cobertura plena. */
export function reducedTeamInput(): GenerationInput {
  return realisticGenerationInput({
    employees: [
      ...PAO_REDUCED.map((e, i) => ({
        uuid: `real-${e.id}`,
        domainId: i + 1,
        employee: e,
      })),
      ...APAO_REDUCED.map((e, i) => ({
        uuid: `real-${e.id}`,
        domainId: PAO_REDUCED.length + i + 1,
        employee: e,
      })),
    ],
  });
}

export function realisticBaselineInput(): GenerationInput {
  return realisticGenerationInput();
}
