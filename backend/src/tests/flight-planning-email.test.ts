import { describe, expect, it } from "vitest";
import { formatFlightPlanningEmail } from "../domain/flight-planning/flight-planning-email.js";

describe("formatFlightPlanningEmail", () => {
  it("agrupa pelo colaborador e ordena as datas", () => {
    const text = formatFlightPlanningEmail([
      {
        employeeId: "b",
        employeeName: "Lucas Wiltgen",
        createdAt: "2026-10-14T18:00:00.000Z",
        lines: [{ date: "2027-08-02", description: "CGH x REC ida e volta" }],
      },
      {
        employeeId: "a",
        employeeName: "Gabriel Castanho",
        createdAt: "2026-10-14T12:00:00.000Z",
        lines: [
          { date: "2027-07-11", description: "SSA x CGH" },
          { date: "2027-07-04", description: "CGH x SSA ida e volta" },
        ],
      },
      {
        employeeId: "a",
        employeeName: "Gabriel Castanho",
        createdAt: "2026-10-15T12:00:00.000Z",
        lines: [{ date: "2027-07-18", description: "CGH x FOR ida e volta" }],
      },
    ]);

    expect(text).toBe(
      [
        "Gabriel Castanho solicita:",
        "Data: 04/07/2027",
        "Solicitação do voo: CGH x SSA ida e volta",
        "",
        "Data: 11/07/2027",
        "Solicitação do voo: SSA x CGH",
        "",
        "Data: 18/07/2027",
        "Solicitação do voo: CGH x FOR ida e volta",
        "",
        "Lucas Wiltgen solicita:",
        "Data: 02/08/2027",
        "Solicitação do voo: CGH x REC ida e volta",
      ].join("\n"),
    );
  });

  it("devolve texto vazio quando não há solicitações", () => {
    expect(formatFlightPlanningEmail([])).toBe("");
  });
});
