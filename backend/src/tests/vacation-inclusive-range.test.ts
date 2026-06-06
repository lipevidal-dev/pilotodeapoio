import { describe, expect, it } from "vitest";
import { buildOperationalCadastroDisplay } from "../application/mappers/operational-cadastro-display.mapper.js";
import { isoDateKey, toDbDate } from "../domain/rules/date-keys.js";
import {
  isIsoDateInInclusiveRange,
  vacationDaysInMonth,
} from "../domain/rules/vacation-dates.js";

const employeeId = "emp-1";

/** Simula retorno Prisma/PostgreSQL DATE (meia-noite UTC). */
function dbDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("vacationDaysInMonth — intervalo inclusivo", () => {
  it("1. férias 01/06 a 15/06 retorna 15 dias", () => {
    const days = vacationDaysInMonth(
      [{ employeeId, startDate: dbDate("2026-06-01"), endDate: dbDate("2026-06-15") }],
      2026,
      6,
    );
    expect(days).toHaveLength(15);
    expect(days[0].date).toBe("2026-06-01");
    expect(days[14].date).toBe("2026-06-15");
  });

  it("2. férias 03/06 a 03/06 retorna 1 dia", () => {
    const days = vacationDaysInMonth(
      [{ employeeId, startDate: dbDate("2026-06-03"), endDate: dbDate("2026-06-03") }],
      2026,
      6,
    );
    expect(days).toEqual([{ employeeUuid: employeeId, date: "2026-06-03" }]);
  });

  it("3. férias 16/06 ao fim do mês inclui o último dia", () => {
    const days = vacationDaysInMonth(
      [{ employeeId, startDate: dbDate("2026-06-16"), endDate: dbDate("2026-06-30") }],
      2026,
      6,
    );
    expect(days).toHaveLength(15);
    expect(days[days.length - 1].date).toBe("2026-06-30");
  });

  it("4. férias mês inteiro inclui todos os dias do mês", () => {
    const days = vacationDaysInMonth(
      [{ employeeId, startDate: dbDate("2026-06-01"), endDate: dbDate("2026-06-30") }],
      2026,
      6,
    );
    expect(days).toHaveLength(30);
    expect(days.map((d) => d.date)).toEqual(
      Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("5. não desloca -1 dia com datas gravadas em T12:00", () => {
    const days = vacationDaysInMonth(
      [
        {
          employeeId,
          startDate: toDbDate("2026-06-03"),
          endDate: toDbDate("2026-06-03"),
        },
      ],
      2026,
      6,
    );
    expect(days).toEqual([{ employeeUuid: employeeId, date: "2026-06-03" }]);
    expect(isoDateKey(toDbDate("2026-06-15"))).toBe("2026-06-15");
  });

  it("6. operationalCadastros inclui último dia do período", () => {
    const vacationDays = vacationDaysInMonth(
      [{ employeeId, startDate: dbDate("2026-06-01"), endDate: dbDate("2026-06-15") }],
      2026,
      6,
    );
    const cadastros = buildOperationalCadastroDisplay({
      vacationDays,
      approvedDayOffs: [],
      flightDays: [],
      preAllocations: [],
    });
    expect(cadastros.filter((c) => c.label === "FÉRIAS")).toHaveLength(15);
    expect(cadastros.some((c) => c.date.startsWith("2026-06-15"))).toBe(true);
  });
});

describe("isIsoDateInInclusiveRange", () => {
  it("inclui início e fim com datas em meia-noite UTC", () => {
    expect(isIsoDateInInclusiveRange("2026-06-01", dbDate("2026-06-01"), dbDate("2026-06-15"))).toBe(
      true,
    );
    expect(isIsoDateInInclusiveRange("2026-06-15", dbDate("2026-06-01"), dbDate("2026-06-15"))).toBe(
      true,
    );
    expect(isIsoDateInInclusiveRange("2026-06-16", dbDate("2026-06-01"), dbDate("2026-06-15"))).toBe(
      false,
    );
  });
});
