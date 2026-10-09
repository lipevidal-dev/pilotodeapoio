import { describe, expect, it } from "vitest";
import {
  canonicalSwapToken,
  isBlankShiftDisplayToken,
  shiftCodeForRecipient,
} from "../domain/schedule/shift-swap-day.js";

const pedro = {
  inInstruction: true,
  instructionStartDate: new Date("2026-10-01T12:00:00.000Z"),
  instructionEndDate: new Date("2026-10-09T12:00:00.000Z"),
};

const nelson = {
  inInstruction: true,
  instructionStartDate: "2026-10-01",
  instructionEndDate: "2026-10-18",
};

describe("shift-swap-day", () => {
  it("trata travessão, meia-risca e hífen como célula vazia", () => {
    expect(isBlankShiftDisplayToken("")).toBe(true);
    expect(isBlankShiftDisplayToken("—")).toBe(true);
    expect(isBlankShiftDisplayToken("–")).toBe(true);
    expect(isBlankShiftDisplayToken("-")).toBe(true);
    expect(isBlankShiftDisplayToken("−")).toBe(true);
    expect(isBlankShiftDisplayToken("em branco")).toBe(true);
    expect(isBlankShiftDisplayToken("T8")).toBe(false);
    expect(canonicalSwapToken("—")).toBe("");
    expect(canonicalSwapToken("em branco")).toBe("");
  });

  it("grava o turno base no histórico, sem prefixo de instrução", () => {
    expect(canonicalSwapToken("TI6")).toBe("T6");
    expect(canonicalSwapToken("T7")).toBe("T7");
    expect(canonicalSwapToken("ti10")).toBe("T10");
    expect(canonicalSwapToken("ND")).toBe("ND");
    expect(canonicalSwapToken("FS")).toBe("FS");
  });

  it("entrega T6 a quem está fora da instrução e TI7 a quem está dentro", () => {
    expect(shiftCodeForRecipient("TI6", pedro, "2026-10-13")).toBe("T6");
    expect(shiftCodeForRecipient("T7", nelson, "2026-10-13")).toBe("TI7");
    expect(shiftCodeForRecipient("TI6", pedro, "2026-10-09")).toBe("TI6");
  });

  it("não transforma ND nem rótulo operacional", () => {
    expect(shiftCodeForRecipient("ND", nelson, "2026-10-13")).toBe("ND");
    expect(shiftCodeForRecipient("FS", pedro, "2026-10-13")).toBe("FS");
    expect(shiftCodeForRecipient("", pedro, "2026-10-13")).toBe("");
  });
});
