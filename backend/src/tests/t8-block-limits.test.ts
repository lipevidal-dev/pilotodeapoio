import { describe, expect, it } from "vitest";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { allocateT8BlocksStrict } from "../domain/schedule/real-schedule-t8.js";
import { countT8BlocksForEmployee, MAX_T8_BLOCKS_PER_PAO_MONTH } from "../domain/schedule/t8-block-limits.js";
import { minimalPaoInput } from "./generation-fixtures.js";

describe("t8-block-limits", () => {
  it("distribui T8 entre PAOs — nenhum PAO recebe todos os blocos", () => {
    const input = minimalPaoInput(6);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    const counts = ws.paoEmps.map((c) => countT8BlocksForEmployee(ws, c.uuid));
    const max = Math.max(...counts);
    const withT8 = counts.filter((n) => n > 0).length;
    expect(withT8).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(MAX_T8_BLOCKS_PER_PAO_MONTH);
  });

  it("respeita máximo de 2 blocos T8 por PAO na alocação inicial", () => {
    const input = minimalPaoInput(4);
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    allocateT8BlocksStrict(ws);

    for (const c of ws.paoEmps) {
      expect(countT8BlocksForEmployee(ws, c.uuid)).toBeLessThanOrEqual(MAX_T8_BLOCKS_PER_PAO_MONTH);
    }
  });
});
