import { describe, expect, it } from "vitest";
import { ScheduleGenerationEngine } from "../domain/schedule/schedule-generation-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

const engine = new ScheduleGenerationEngine();
const SLOW_MS = 120_000;

function paoUuid(i = 0): string {
  return `real-${i + 1}`;
}

describe("Continuidade entre meses", () => {
  it("1. T8/T8 em fim de mês gera ND no 1º dia do mês seguinte", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [
          { employeeUuid: paoUuid(0), date: "2026-06-29", shiftCode: "T8" },
          { employeeUuid: paoUuid(0), date: "2026-06-30", shiftCode: "T8" },
        ],
        allocations: [],
      },
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.ensureNdForT8Pairs();
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === paoUuid(0) && a.date === "2026-07-01" && a.label === "ND",
      ),
    ).toBe(true);
  });

  it("2. ND no início respeita T8 do mês anterior", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [
          { employeeUuid: paoUuid(1), date: "2026-06-30", shiftCode: "T8" },
          { employeeUuid: paoUuid(1), date: "2026-07-01", shiftCode: "T8" },
        ],
        allocations: [],
      },
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.ensureNdForT8Pairs();
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === paoUuid(1) && a.date === "2026-07-02" && a.label === "ND",
      ),
    ).toBe(true);
  });

  it("3. 6x1 APAO continua ao virar o mês", () => {
    const apao = paoUuid(6);
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [
          { employeeUuid: apao, date: "2026-06-26", shiftCode: "T2" },
          { employeeUuid: apao, date: "2026-06-27", shiftCode: "T2" },
          { employeeUuid: apao, date: "2026-06-28", shiftCode: "T2" },
          { employeeUuid: apao, date: "2026-06-29", shiftCode: "T2" },
          { employeeUuid: apao, date: "2026-06-30", shiftCode: "T2" },
        ],
        allocations: [],
      },
    });
    const ws = new GenerationWorkspace(input);
    const did = ws["uuidToDomain"].get(apao)!;
    ws["planned"].set(`${did}|2026-07-01`, "T2");
    ws.allocateApaoRestDays();
    expect(
      ws.allocations.some(
        (a) =>
          a.employeeUuid === apao &&
          a.date === "2026-07-02" &&
          ["FOLGA", "FOLGA AGRUPADA"].includes(a.label),
      ),
    ).toBe(true);
  });

  it("6. FS no fim de semana do mês anterior impede nova FS no mês seguinte", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [],
        allocations: [
          { employeeUuid: paoUuid(3), date: "2026-06-27", label: "FOLGA SOCIAL" },
          { employeeUuid: paoUuid(3), date: "2026-06-28", label: "FOLGA SOCIAL" },
        ],
      },
    });
    const ws = new GenerationWorkspace(input);
    ws.planFolgaSocial();
    expect(
      ws.allocations.filter(
        (a) => a.employeeUuid === paoUuid(3) && a.label === "FOLGA SOCIAL",
      ).length,
    ).toBe(0);
  });

  it("4. folga pós-férias no 1º dia quando férias terminaram no mês anterior", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      vacationReturnDays: [{ employeeUuid: paoUuid(2), date: "2026-07-01" }],
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === paoUuid(2) && a.date === "2026-07-01" && a.label === "FOLGA",
      ),
    ).toBe(true);
  });

  it("5. FANI no último dia do mês anterior gera folga no 1º dia do mês seguinte", () => {
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [],
        allocations: [
          { employeeUuid: paoUuid(4), date: "2026-06-30", label: "FOLGA ANIVERSÁRIO" },
        ],
      },
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === paoUuid(4) && a.date === "2026-07-01" && a.label === "FOLGA",
      ),
    ).toBe(true);
  });

  it("7. carryover 6x1 impõe folga no 1º dia após 6 turnos no fim de junho", () => {
    const uuid = paoUuid(0);
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [
          { employeeUuid: uuid, date: "2026-06-25", shiftCode: "T6" },
          { employeeUuid: uuid, date: "2026-06-26", shiftCode: "T6" },
          { employeeUuid: uuid, date: "2026-06-27", shiftCode: "T6" },
          { employeeUuid: uuid, date: "2026-06-28", shiftCode: "T6" },
          { employeeUuid: uuid, date: "2026-06-29", shiftCode: "T6" },
          { employeeUuid: uuid, date: "2026-06-30", shiftCode: "T6" },
        ],
        allocations: [],
      },
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    ws.enforceMonthStart6x1FromPrevious();
    expect(
      ws.allocations.some(
        (a) => a.employeeUuid === uuid && a.date === "2026-07-01" && a.label === "FOLGA",
      ),
    ).toBe(true);
  });

  it("9. simuladores no fim de junho contam na continuidade 6x1 de julho", () => {
    const uuid = paoUuid(2);
    const input = realisticGenerationInput({
      year: 2026,
      month: 7,
      crossMonthHistory: {
        assignments: [],
        allocations: [
          { employeeUuid: uuid, date: "2026-06-29", label: "SIMULADOR" },
          { employeeUuid: uuid, date: "2026-06-30", label: "SIMULADOR" },
        ],
      },
    });
    const ws = new GenerationWorkspace(input);
    ws.applyHardBlocks();
    const did = ws.uuidToDomain.get(uuid)!;
    expect(ws.tryAssignShift(uuid, "2026-07-01", "T6")).toBe(true);
    expect(ws.tryAssignShift(uuid, "2026-07-02", "T6")).toBe(true);
    expect(ws.tryAssignShift(uuid, "2026-07-03", "T6")).toBe(true);
    expect(ws.tryAssignShift(uuid, "2026-07-04", "T6")).toBe(true);
    expect(ws.tryAssignShift(uuid, "2026-07-05", "T6")).toBe(false);
    expect(ws.planned.get(`${did}|2026-07-05`)).toBeUndefined();
  });

  it(
    "8. geração de julho com histórico de junho difere de geração isolada",
    () => {
      const isolated = engine.generate(realisticGenerationInput({ year: 2026, month: 7 }));
      const withHistory = engine.generate(
        realisticGenerationInput({
          year: 2026,
          month: 7,
          crossMonthHistory: {
            assignments: [
              { employeeUuid: paoUuid(0), date: "2026-06-29", shiftCode: "T8" },
              { employeeUuid: paoUuid(0), date: "2026-06-30", shiftCode: "T8" },
            ],
            allocations: [],
          },
        }),
      );
      const isolatedNd = isolated.allocations.filter(
        (a) => a.date === "2026-07-01" && a.label === "ND",
      ).length;
      const historyNd = withHistory.allocations.filter(
        (a) => a.date === "2026-07-01" && a.label === "ND",
      ).length;
      expect(historyNd).toBeGreaterThanOrEqual(isolatedNd);
    },
    SLOW_MS,
  );
});
