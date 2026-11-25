import { describe, expect, it } from "vitest";
import { manualRangeBodySchema } from "../interfaces/http/dto/manual-schedule-edit.dto.js";

const BASE = {
  employeeId: "11111111-1111-1111-1111-111111111111",
  startDate: "2026-12-25",
  endDate: "2026-12-25",
  mode: "set",
};

describe("manualRangeBodySchema FF aliases", () => {
  it("aceita FF", () => {
    expect(manualRangeBodySchema.parse({ ...BASE, type: "FF" }).type).toBe("FF");
  });

  it("aceita FOLGA FERIADO / Folga Feriado", () => {
    expect(manualRangeBodySchema.parse({ ...BASE, type: "FOLGA FERIADO" }).type).toBe("FF");
    expect(manualRangeBodySchema.parse({ ...BASE, type: "Folga Feriado" }).type).toBe("FF");
  });

  it("corta data ISO para YYYY-MM-DD", () => {
    const parsed = manualRangeBodySchema.parse({
      ...BASE,
      startDate: "2026-12-25T00:00:00.000Z",
      endDate: "2026-12-25T03:00:00.000-04:00",
      type: "FF",
    });
    expect(parsed.startDate).toBe("2026-12-25");
    expect(parsed.endDate).toBe("2026-12-25");
  });
});
