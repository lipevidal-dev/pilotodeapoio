import { describe, expect, it } from "vitest";
import { buildOperationalCadastroDisplay } from "../application/mappers/operational-cadastro-display.mapper.js";
import { mockCadastroPreAllocationRow } from "./pre-allocation-fixtures.js";

describe("buildOperationalCadastroDisplay", () => {
  it("mescla férias, FP aprovada, voo e pré-alocações por label", () => {
    const rows = buildOperationalCadastroDisplay({
      vacationDays: [{ employeeUuid: "emp-1", date: "2026-06-01" }],
      approvedDayOffs: [{ employeeUuid: "emp-1", date: "2026-06-02" }],
      flightDays: [{ employeeUuid: "emp-1", date: "2026-06-03", description: "GRU-SDU" }],
      preAllocations: [
        mockCadastroPreAllocationRow({
          id: "sim-1",
          employeeId: "emp-1",
          date: new Date("2026-06-04T12:00:00.000Z"),
          label: "SIMULADOR",
        }),
        mockCadastroPreAllocationRow({
          id: "voo-pre",
          employeeId: "emp-1",
          date: new Date("2026-06-05T12:00:00.000Z"),
          label: "VOO",
        }),
      ],
    });

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.label)).toEqual([
      "FÉRIAS",
      "FOLGA PEDIDA",
      "VOO",
      "SIMULADOR",
    ]);
  });

  it("inclui CURSO, CMA e OUTRO das pré-alocações", () => {
    const rows = buildOperationalCadastroDisplay({
      vacationDays: [],
      approvedDayOffs: [],
      flightDays: [],
      preAllocations: [
        mockCadastroPreAllocationRow({
          id: "c1",
          employeeId: "emp-2",
          date: new Date("2026-06-10T12:00:00.000Z"),
          label: "CURSO",
        }),
        mockCadastroPreAllocationRow({
          id: "c2",
          employeeId: "emp-2",
          date: new Date("2026-06-11T12:00:00.000Z"),
          label: "CMA",
        }),
        mockCadastroPreAllocationRow({
          id: "c3",
          employeeId: "emp-2",
          date: new Date("2026-06-12T12:00:00.000Z"),
          label: "OUTRO",
        }),
      ],
    });

    expect(rows.map((r) => r.label)).toEqual(["CURSO", "CMA", "OUTRO"]);
  });
});
