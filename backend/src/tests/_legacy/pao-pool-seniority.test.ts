import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import type { GenerationInputEmployee } from "../domain/schedule/generation-types.js";
import {
  buildPaoPoolSeniorityIndex,
  sortPaoByPoolSeniority,
} from "../domain/schedule/pao-pool-seniority.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";
import { realPaoUuid } from "./schedule-slices/slice-helpers.js";
import { v5AllocatePreferredTurnsBySeniority } from "../domain/schedule/v5-quota-allocation.js";

function pao(id: number, seniority: number): GenerationInputEmployee {
  return {
    uuid: realPaoUuid(id - 1),
    domainId: id,
    employee: { id, name: `PAO ${id}`, role: "PAO", seniority },
  };
}

function apao(id: number, seniority: number): GenerationInputEmployee {
  return {
    uuid: `apao-${id}`,
    domainId: 100 + id,
    employee: { id: 100 + id, name: `APAO ${id}`, role: "APAO", seniority },
  };
}

describe("Pool PAO — senioridade exclui APAO", () => {
  it("buildPaoPoolSeniorityIndex considera só PAOs", () => {
    const input = realisticGenerationInput({
      month: 7,
      employees: [apao(1, 1), apao(2, 2), apao(3, 3), pao(1, 4), pao(2, 11)],
    });
    const ws = new GenerationWorkspace(input);
    const index = buildPaoPoolSeniorityIndex(ws);

    expect(ws.paoEmps.length).toBe(2);
    expect(ws.apaoEmps.length).toBe(3);
    expect(index.size).toBe(2);

    const senior = index.get(realPaoUuid(0))!;
    const junior = index.get(realPaoUuid(1))!;
    expect(senior.poolRank).toBe(1);
    expect(junior.poolRank).toBe(2);
    expect(senior.poolSize).toBe(2);
    expect(junior.cadastralSeniority).toBe(11);
    expect(junior.poolRank).toBe(2);
  });

  it("APAOs com senioridade 1,2,3 não alteram ordem PAO na fase preferida", () => {
    const paos = [pao(1, 3), pao(2, 9), pao(3, 11), pao(4, 12)];
    const preferredShifts = new Map([
      [1, new Set(["T8"])],
      [2, new Set(["T8"])],
      [3, new Set(["T8"])],
      [4, new Set(["T8"])],
    ]);

    const baseInput = realisticGenerationInput({
      month: 7,
      employees: paos,
      preferredShifts,
    });
    const withApaoInput = realisticGenerationInput({
      month: 7,
      employees: [apao(1, 1), apao(2, 2), apao(3, 3), ...paos],
      preferredShifts,
    });

    function t8ByPao(input: typeof baseInput) {
      const ws = new GenerationWorkspace(input);
      ws.realV1ManualCommonFolga = true;
      ws.applyHardBlocks();
      ws.initRateioContext();
      v5AllocatePreferredTurnsBySeniority(ws, []);
      const out = new Map<string, number>();
      for (const c of paos) {
        out.set(
          c.uuid,
          ws.toAssignments().filter((a) => a.employeeUuid === c.uuid && a.shiftCode === "T8").length,
        );
      }
      return { ws, out };
    }

    const base = t8ByPao(baseInput);
    const mixed = t8ByPao(withApaoInput);

    expect(sortPaoByPoolSeniority(base.ws).map((c) => c.uuid)).toEqual(
      sortPaoByPoolSeniority(mixed.ws).map((c) => c.uuid),
    );

    for (const c of paos) {
      expect(mixed.out.get(c.uuid)).toBe(base.out.get(c.uuid));
      expect(mixed.ws.rateioContext!.paoPoolSeniorityByEmployee.get(c.uuid)).toEqual(
        base.ws.rateioContext!.paoPoolSeniorityByEmployee.get(c.uuid),
      );
    }
  });
});
