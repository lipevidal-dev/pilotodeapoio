import { describe, expect, it } from "vitest";
import {
  calendarQueryRange,
  expandVacationPeriodsToDays,
  mapVacationRowsToCalendarPeriods,
} from "../domain/rules/vacation-calendar.js";
import { VacationUseCase } from "../application/use-cases/vacation.use-case.js";
import type { VacationRepository } from "../infrastructure/repositories/vacation.repository.js";

describe("calendário de férias do portal", () => {
  it("inclui folga de 6 dias além do mês para a grade", () => {
    expect(calendarQueryRange(2026, 10)).toEqual({
      start: "2026-09-25",
      end: "2026-11-06",
    });
  });

  it("omite rejeitadas e marca o pedido do próprio colaborador", () => {
    const periods = mapVacationRowsToCalendarPeriods(
      [
        {
          id: "v-rej",
          employeeId: "e-2",
          startDate: "2026-10-01",
          endDate: "2026-10-05",
          status: "REJECTED",
          employee: { name: "Bruno" },
        },
        {
          id: "v-me",
          employeeId: "e-1",
          startDate: "2026-10-10T00:00:00.000Z",
          endDate: "2026-10-12T00:00:00.000Z",
          status: "PENDING",
          employee: { name: "Ana" },
        },
        {
          id: "v-other",
          employeeId: "e-2",
          startDate: "2026-10-11",
          endDate: "2026-10-20",
          status: "APPROVED",
          employee: { name: "Bruno" },
        },
      ],
      "e-1",
    );

    expect(periods.map((p) => p.id)).toEqual(["v-me", "v-other"]);
    expect(periods[0]).toMatchObject({ mine: true, employeeName: "Ana", status: "PENDING" });
    expect(periods[1]).toMatchObject({ mine: false, employeeName: "Bruno", status: "APPROVED" });
  });

  it("expande períodos nos dias do intervalo, com o próprio colaborador primeiro", () => {
    const days = expandVacationPeriodsToDays(
      [
        {
          id: "v-other",
          employeeId: "e-2",
          employeeName: "Bruno",
          startDate: "2026-10-11",
          endDate: "2026-10-12",
          status: "APPROVED",
          mine: false,
        },
        {
          id: "v-me",
          employeeId: "e-1",
          employeeName: "Ana",
          startDate: "2026-10-12",
          endDate: "2026-10-12",
          status: "PENDING",
          mine: true,
        },
      ],
      "2026-10-01",
      "2026-10-31",
    );

    expect(days["2026-10-11"]).toHaveLength(1);
    expect(days["2026-10-12"]?.map((e) => e.employeeName)).toEqual(["Ana", "Bruno"]);
    expect(days["2026-10-13"]).toBeUndefined();
  });

  it("use-case consulta só o intervalo visível e devolve períodos mapeados", async () => {
    const queried: Array<{ start: string; end: string }> = [];
    const repo = {
      findVisibleOverlapping: async (startDate: string, endDate: string) => {
        queried.push({ start: startDate, end: endDate });
        return [
          {
            id: "v1",
            employeeId: "e-9",
            startDate: new Date("2026-10-05T00:00:00.000Z"),
            endDate: new Date("2026-10-08T00:00:00.000Z"),
            status: "APPROVED",
            employee: { id: "e-9", name: "Carla" },
          },
        ];
      },
    } as unknown as VacationRepository;

    const uc = new VacationUseCase(repo);
    const result = await uc.portalCalendar(2026, 10, "e-9");

    expect(queried).toEqual([{ start: "2026-09-25", end: "2026-11-06" }]);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(10);
    expect(result.periods).toEqual([
      {
        id: "v1",
        employeeId: "e-9",
        employeeName: "Carla",
        startDate: "2026-10-05",
        endDate: "2026-10-08",
        status: "APPROVED",
        mine: true,
      },
    ]);
    expect(result.days["2026-10-05"]).toHaveLength(1);
    expect(result.days["2026-10-08"]?.[0]?.employeeName).toBe("Carla");
    expect(result.days["2026-10-09"]).toBeUndefined();
  });
});
