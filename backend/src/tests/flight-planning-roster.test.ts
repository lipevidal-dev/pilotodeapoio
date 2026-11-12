import { describe, expect, it } from "vitest";
import {
  buildFlightPlanningRoster,
  type FlightPlanningRosterEmployee,
} from "../domain/flight-planning/flight-planning-roster.js";

function person(
  partial: Partial<FlightPlanningRosterEmployee> & Pick<FlightPlanningRosterEmployee, "id" | "name">,
): FlightPlanningRosterEmployee {
  return {
    active: true,
    type: "PAO",
    isFcf: false,
    isCmte: false,
    ...partial,
  };
}

describe("buildFlightPlanningRoster", () => {
  it("lista PAO e copiloto FCF, com check só para quem enviou", () => {
    const roster = buildFlightPlanningRoster(
      [
        person({ id: "apao", name: "Cesar Rocha", type: "APAO" }),
        person({ id: "cmte", name: "Dreher", isFcf: true, isCmte: true }),
        person({ id: "fcf", name: "Gabriel Castanho", isFcf: true }),
        person({ id: "pao", name: "Felipe Vidal" }),
        person({ id: "off", name: "Inativo", active: false }),
      ],
      ["fcf"],
    );

    expect(roster.map((row) => [row.name, row.requested])).toEqual([
      ["Felipe Vidal", false],
      ["Gabriel Castanho", true],
    ]);
  });
});
