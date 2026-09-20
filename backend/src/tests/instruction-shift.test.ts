import { describe, expect, it } from "vitest";
import {
  applyInstructionShiftIfNeeded,
  baseShiftCode,
  isInInstructionOnDate,
  isInstructionShiftCode,
  toInstructionShiftCode,
} from "../domain/schedule/instruction-shift.js";

describe("instruction-shift.util", () => {
  it("converte T6 em TI6", () => {
    expect(toInstructionShiftCode("T6")).toBe("TI6");
    expect(toInstructionShiftCode("T10")).toBe("TI10");
  });

  it("extrai turno base de TI8", () => {
    expect(baseShiftCode("TI8")).toBe("T8");
    expect(isInstructionShiftCode("TI8")).toBe(true);
  });

  it("aplica prefixo quando funcionário está em instrução", () => {
    expect(applyInstructionShiftIfNeeded("T7", true)).toBe("TI7");
    expect(applyInstructionShiftIfNeeded("T7", false)).toBe("T7");
    expect(applyInstructionShiftIfNeeded("ND", true)).toBe("ND");
  });

  it("respeita janela de datas e ignora flag stale fora dela", () => {
    const emp = {
      inInstruction: true,
      instructionStartDate: "2026-07-01",
      instructionEndDate: "2026-07-17",
    };
    expect(isInInstructionOnDate(emp, "2026-07-10")).toBe(true);
    expect(isInInstructionOnDate(emp, "2026-07-17")).toBe(true);
    expect(isInInstructionOnDate(emp, "2026-07-18")).toBe(false);
    expect(isInInstructionOnDate(emp, "2026-11-01")).toBe(false);
  });

  it("sem janela usa o boolean inInstruction", () => {
    expect(isInInstructionOnDate({ inInstruction: true }, "2026-11-01")).toBe(true);
    expect(isInInstructionOnDate({ inInstruction: false }, "2026-11-01")).toBe(false);
  });
});
