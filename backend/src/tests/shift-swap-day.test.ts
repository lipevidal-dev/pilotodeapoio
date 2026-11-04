import { describe, expect, it } from "vitest";
import {
  assignmentWriteFromDay,
  displayTokenFromDay,
  hydrateDaySnapshot,
  isBlankDisplayToken,
  pairAlreadyApplied,
  snapshotFromToken,
  type DaySnapshot,
} from "../application/use-cases/shift-swap-day.js";

const empty: DaySnapshot = { assignment: null, preAllocation: null };

const shift = (code: string, label: string | null = null): DaySnapshot => ({
  assignment: { shiftCode: code, label },
  preAllocation: null,
});

const labelOnly = (label: string): DaySnapshot => ({
  assignment: { shiftCode: "", label },
  preAllocation: null,
});

describe("shift-swap-day — hidratação da troca", () => {
  it("não trata folga/FA em branco", () => {
    expect(isBlankDisplayToken("")).toBe(true);
    expect(isBlankDisplayToken("em branco")).toBe(true);
    expect(isBlankDisplayToken("-")).toBe(true);
    expect(isBlankDisplayToken("T8")).toBe(false);
    expect(isBlankDisplayToken("FA")).toBe(false);
  });

  it("lê FA pelo label quando o shiftCode veio vazio", () => {
    expect(displayTokenFromDay(labelOnly("Folga agrupada"))).toBe("FA");
    expect(assignmentWriteFromDay(labelOnly("Folga agrupada"))).toEqual({
      shiftCode: "FA",
      label: "Folga agrupada",
    });
  });

  it("hidrata do planejado quando a realizada está vazia", () => {
    const hydrated = hydrateDaySnapshot(empty, shift("T8"), "");
    expect(displayTokenFromDay(hydrated)).toBe("T8");
  });

  it("hidrata do token da troca quando realizada e planejada estão vazias", () => {
    const hydrated = hydrateDaySnapshot(empty, empty, "T1");
    expect(displayTokenFromDay(hydrated)).toBe("T1");
    expect(assignmentWriteFromDay(hydrated)?.shiftCode).toBe("T1");
  });

  it("não grava assignment vazio por cima de um turno", () => {
    expect(assignmentWriteFromDay(empty)).toBeNull();
    expect(assignmentWriteFromDay(shift("T4"))?.shiftCode).toBe("T4");
  });

  it("não considera aplicada quando os dois lados ficaram em branco", () => {
    expect(pairAlreadyApplied(empty, empty, "T6", "T8")).toBe(false);
  });

  it("reconhece o resultado já persistido", () => {
    expect(pairAlreadyApplied(shift("T8"), shift("T6"), "T6", "T8")).toBe(true);
    expect(pairAlreadyApplied(shift("T6"), shift("T8"), "T6", "T8")).toBe(false);
  });

  it("monta FA a partir do token para não sumir na escrita", () => {
    const fa = snapshotFromToken("FA");
    expect(displayTokenFromDay(fa)).toBe("FA");
    expect(fa.preAllocation?.label).toBe("FOLGA AGRUPADA");
  });
});
