import { describe, expect, it } from "vitest";
import {
  flightPlanningMonthLabel,
  monthsTouched,
  periodWindowStatus,
  saoPauloDateKey,
} from "../domain/flight-planning/flight-planning-period.js";

describe("meses do período de Voos Planejamento", () => {
  it("quebra um intervalo que cruza o ano em um pacote por mês", () => {
    expect(monthsTouched("2026-11-01", "2027-01-12")).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
    expect(flightPlanningMonthLabel(2026, 11)).toBe("Novembro/2026");
  });

  it("considera o dia em São Paulo e o estado do período", () => {
    expect(saoPauloDateKey(new Date("2026-11-01T01:30:00.000Z"))).toBe("2026-10-31");
    expect(periodWindowStatus("2026-10-20", "2026-11-01", "2027-01-12", false)).toBe("scheduled");
    expect(periodWindowStatus("2026-11-15", "2026-11-01", "2027-01-12", false)).toBe("open");
    expect(periodWindowStatus("2026-11-15", "2026-11-01", "2027-01-12", true)).toBe("closed");
    expect(periodWindowStatus("2027-01-13", "2026-11-01", "2027-01-12", false)).toBe("closed");
  });
});
