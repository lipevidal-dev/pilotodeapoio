import { describe, expect, it } from "vitest";
import { detectVacationFortnight } from "../domain/schedule/clean-engine/clean-vacation-fortnight.js";

describe("clean-vacation-fortnight", () => {
  const julyDays = Array.from({ length: 31 }, (_, i) => {
    const d = String(i + 1).padStart(2, "0");
    return `2026-07-${d}`;
  });

  it("detecta férias na primeira quinzena", () => {
    const vac = julyDays.slice(0, 15);
    expect(detectVacationFortnight(julyDays, vac)).toBe("FIRST_HALF");
  });

  it("detecta férias na segunda quinzena", () => {
    const vac = julyDays.slice(15, 30);
    expect(detectVacationFortnight(julyDays, vac)).toBe("SECOND_HALF");
  });

  it("ignora férias esparsas", () => {
    expect(detectVacationFortnight(julyDays, ["2026-07-01", "2026-07-15", "2026-07-30"])).toBeNull();
  });
});
