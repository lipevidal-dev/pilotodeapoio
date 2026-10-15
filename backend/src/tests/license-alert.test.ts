import { describe, expect, it } from "vitest";
import { addIsoDays, isLicenseDueSoon, saoPauloDateKey } from "../domain/employee/license-alert.js";

describe("alerta de licenças e habilitações", () => {
  it("abre o alerta 60 dias antes e mantém o vencido", () => {
    expect(addIsoDays("2026-10-15", 60)).toBe("2026-12-14");
    expect(isLicenseDueSoon("2026-12-14", "2026-10-15")).toBe(true);
    expect(isLicenseDueSoon("2026-12-15", "2026-10-15")).toBe(false);
    expect(isLicenseDueSoon("2026-10-15", "2026-10-15")).toBe(true);
    expect(isLicenseDueSoon("2026-10-14", "2026-10-15")).toBe(true);
  });

  it("usa o dia em America/Sao_Paulo", () => {
    expect(saoPauloDateKey(new Date("2026-10-15T02:30:00.000Z"))).toBe("2026-10-14");
    expect(saoPauloDateKey(new Date("2026-10-15T03:30:00.000Z"))).toBe("2026-10-15");
  });
});
