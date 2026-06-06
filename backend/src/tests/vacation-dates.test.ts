import { describe, expect, it } from "vitest";
import { isoDateKey, toDbDate } from "../domain/rules/date-keys.js";
import { VacationUseCase } from "../application/use-cases/vacation.use-case.js";
import type { VacationRepository } from "../infrastructure/repositories/vacation.repository.js";

describe("Férias — datas sem offset de timezone", () => {
  it("1. dia único grava e retorna mesma data", async () => {
    const stored: { start: string; end: string }[] = [];
    const repo = {
      findAll: async () => [],
      findById: async () => null,
      findByEmployee: async () => [],
      create: async (data: { startDate: string; endDate: string }) => {
        stored.push({ start: data.startDate, end: data.endDate });
        return {
          id: "v1",
          employeeId: "e1",
          startDate: toDbDate(data.startDate),
          endDate: toDbDate(data.endDate),
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          employee: { id: "e1", name: "PAO", type: "PAO", roleId: null, active: true, createdAt: new Date(), updatedAt: new Date() },
        };
      },
      delete: async () => undefined,
    } as unknown as VacationRepository;

    const uc = new VacationUseCase(repo);
    const created = await uc.create({
      employeeId: "e1",
      startDate: "2026-06-02",
      endDate: "2026-06-02",
    });

    expect(stored[0]).toEqual({ start: "2026-06-02", end: "2026-06-02" });
    expect(created.startDate).toBe("2026-06-02");
    expect(created.endDate).toBe("2026-06-02");
  });

  it("2. primeira quinzena preserva início e fim", async () => {
    expect(isoDateKey(toDbDate("2026-06-01"))).toBe("2026-06-01");
    expect(isoDateKey(toDbDate("2026-06-15"))).toBe("2026-06-15");
  });

  it("3. segunda quinzena preserva início e fim", () => {
    expect(isoDateKey("2026-06-16T00:00:00.000Z")).toBe("2026-06-16");
    expect(isoDateKey("2026-06-30T00:00:00.000Z")).toBe("2026-06-30");
  });

  it("4. mês inteiro junho", () => {
    expect(isoDateKey(toDbDate("2026-06-01"))).toBe("2026-06-01");
    expect(isoDateKey(toDbDate("2026-06-30"))).toBe("2026-06-30");
  });

  it("5. UTC midnight ISO não desloca -1", () => {
    expect(isoDateKey("2026-06-05T00:00:00.000Z")).toBe("2026-06-05");
    expect(isoDateKey("2026-06-05T23:59:59.000Z")).toBe("2026-06-05");
  });

  it("6. férias atravessando meses — chaves ISO estáveis", () => {
    expect(isoDateKey(toDbDate("2026-06-20"))).toBe("2026-06-20");
    expect(isoDateKey(toDbDate("2026-07-04"))).toBe("2026-07-04");
  });
});
