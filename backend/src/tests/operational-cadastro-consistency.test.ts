import { describe, expect, it } from "vitest";
import { buildOperationalCadastroDisplay } from "../application/mappers/operational-cadastro-display.mapper.js";
import { deduplicateOperationalCadastros } from "../domain/rules/operational-cadastro-priority.js";

describe("operationalCadastros — consistência calendário x escala", () => {
  it("VOO manual aparece em operationalCadastros", () => {
    const rows = buildOperationalCadastroDisplay({
      vacationDays: [],
      approvedDayOffs: [],
      flightDays: [{ employeeUuid: "emp-1", date: "2026-06-05", description: "GRU" }],
      preAllocations: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      employeeId: "emp-1",
      label: "VOO",
      source: "flight",
    });
    expect(rows[0].date).toContain("2026-06-05");
  });

  it("ignora VOO legado em preAllocations sem flightAssignment", () => {
    const rows = buildOperationalCadastroDisplay({
      vacationDays: [],
      approvedDayOffs: [],
      flightDays: [],
      preAllocations: [
        {
          id: "pre-voo-ghost",
          employeeId: "emp-1",
          date: new Date("2026-06-05T00:00:00.000Z"),
          label: "VOO",
        },
      ],
    });
    expect(rows.filter((r) => r.label === "VOO")).toHaveLength(0);
  });

  it("não duplica VOO de flightAssignments com preAllocation VOO legada", () => {
    const rows = buildOperationalCadastroDisplay({
      vacationDays: [],
      approvedDayOffs: [],
      flightDays: [{ employeeUuid: "emp-1", date: "2026-06-05" }],
      preAllocations: [
        {
          id: "pre-voo",
          employeeId: "emp-1",
          date: new Date("2026-06-05T00:00:00.000Z"),
          label: "VOO",
        },
      ],
    });
    const vooRows = rows.filter((r) => r.label === "VOO");
    expect(vooRows).toHaveLength(1);
    expect(vooRows[0].source).toBe("flight");
  });

  it("deduplica employeeId+date mantendo prioridade dominante", () => {
    const deduped = deduplicateOperationalCadastros(
      buildOperationalCadastroDisplay({
        vacationDays: [{ employeeUuid: "emp-1", date: "2026-06-05" }],
        approvedDayOffs: [],
        flightDays: [{ employeeUuid: "emp-1", date: "2026-06-05" }],
        preAllocations: [],
      }),
    );
    expect(deduped).toHaveLength(1);
    expect(deduped[0].label).toBe("FÉRIAS");
  });

  it("Simulador/Curso/CMA/Outro aparecem com label correto", () => {
    const rows = buildOperationalCadastroDisplay({
      vacationDays: [],
      approvedDayOffs: [],
      flightDays: [],
      preAllocations: [
        {
          id: "1",
          employeeId: "emp-1",
          date: new Date("2026-06-01T12:00:00.000Z"),
          label: "SIMULADOR",
        },
        {
          id: "2",
          employeeId: "emp-1",
          date: new Date("2026-06-02T12:00:00.000Z"),
          label: "CURSO",
        },
        {
          id: "3",
          employeeId: "emp-1",
          date: new Date("2026-06-03T12:00:00.000Z"),
          label: "CMA",
        },
        {
          id: "4",
          employeeId: "emp-1",
          date: new Date("2026-06-04T12:00:00.000Z"),
          label: "OUTRO",
        },
      ],
    });
    expect(rows.map((r) => r.label)).toEqual(["SIMULADOR", "CURSO", "CMA", "OUTRO"]);
  });
});
