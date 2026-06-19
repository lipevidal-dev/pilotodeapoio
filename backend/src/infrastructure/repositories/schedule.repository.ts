import type { RuleSeverity } from "@prisma/client";
import { compareEmployeesBySeniority } from "../../domain/employee/seniority.js";
import type { ShiftRestrictionRow } from "../../domain/schedule/generation-types.js";
import {
  allocationsFromDb,
  assignmentsFromDb,
  filterHistoryByLookback,
  lookbackStartDate,
  mergeCrossMonthAllocations,
  type CrossMonthHistory,
} from "../../domain/schedule/cross-month-history.js";
import { listClearablePreAllocationLabels } from "../../domain/schedule/clear-generated-policy.js";
import { REGENERATION_CLEAR_LABELS } from "../../domain/schedule/operational-labels.js";
import { iterDays, addDays } from "../../domain/rules/dates.js";
import { isoDateKey, toDbDate } from "../../domain/rules/date-keys.js";
import { prisma } from "../database/prisma-client.js";
export class ScheduleRepository {
  async findMonth(year: number, month: number) {
    return prisma.scheduleMonth.findUnique({
      where: { year_month: { year, month } },
      include: {
        assignments: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
        ruleViolations: { orderBy: { createdAt: "desc" } },
      },
    });
  }

  async findMonthById(id: string) {
    return prisma.scheduleMonth.findUnique({
      where: { id },
      include: {
        assignments: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
        ruleViolations: { orderBy: { createdAt: "desc" } },
      },
    });
  }

  async findPublishedMonth(year: number, month: number) {
    return prisma.scheduleMonth.findFirst({
      where: { year, month, status: "PUBLISHED" },
      include: {
        assignments: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
      },
    });
  }

  async ensureMonth(year: number, month: number) {
    return prisma.scheduleMonth.upsert({
      where: { year_month: { year, month } },
      create: { year, month },
      update: {},
    });
  }

  async upsertGeneratedMonth(year: number, month: number) {
    return prisma.scheduleMonth.upsert({
      where: { year_month: { year, month } },
      create: { year, month, status: "GENERATED" },
      update: { status: "GENERATED" },
    });
  }

  async publishMonth(id: string) {
    return prisma.scheduleMonth.update({
      where: { id },
      data: { status: "PUBLISHED" },
    });
  }

  async clearForRegeneration(scheduleMonthId: string) {
    await prisma.scheduleAssignment.deleteMany({ where: { scheduleMonthId } });
    await prisma.preAllocation.deleteMany({
      where: {
        scheduleMonthId,
        label: { in: [...REGENERATION_CLEAR_LABELS] },
        NOT: { notes: { startsWith: "cross-month:" } },
      },
    });
  }

  async clearApaoGeneratedData(scheduleMonthId: string, apaoEmployeeIds: string[]) {
    if (apaoEmployeeIds.length === 0) return;
    await prisma.scheduleAssignment.deleteMany({
      where: { scheduleMonthId, employeeId: { in: apaoEmployeeIds } },
    });
    await prisma.preAllocation.deleteMany({
      where: {
        scheduleMonthId,
        employeeId: { in: apaoEmployeeIds },
        label: { in: ["FOLGA AGRUPADA", "FOLGA"] },
      },
    });
  }

  async clearGeneratedData(scheduleMonthId: string) {
    const month = await prisma.scheduleMonth.findUnique({ where: { id: scheduleMonthId } });
    if (!month) {
      throw new Error(`ScheduleMonth ${scheduleMonthId} não encontrado`);
    }

    const days = iterDays(month.year, month.month);
    const start = toDbDate(days[0]!);
    const end = toDbDate(days[days.length - 1]!);

    // Somente pré-alocações geradas pelo motor — cadastros manuais (FP, sim, curso, etc.) permanecem
    await prisma.preAllocation.deleteMany({
      where: {
        scheduleMonthId,
        label: { in: [...listClearablePreAllocationLabels()] },
      },
    });

    // Voos gerados automaticamente — voos manuais (cadastro operacional) permanecem
    await prisma.flightAssignment.deleteMany({
      where: {
        date: { gte: start, lte: end },
        source: "GENERATOR",
      },
    });

    await prisma.scheduleAssignment.deleteMany({ where: { scheduleMonthId } });

    await prisma.ruleViolation.deleteMany({ where: { scheduleMonthId } });

    return prisma.scheduleMonth.update({
      where: { id: scheduleMonthId },
      data: { status: "DRAFT" },
    });
  }

  async saveAssignments(
    scheduleMonthId: string,
    rows: Array<{ employeeUuid: string; date: string; shiftCode: string }>,
  ) {
    if (rows.length === 0) return;
    await prisma.scheduleAssignment.createMany({
      data: rows.map((r) => ({
        scheduleMonthId,
        employeeId: r.employeeUuid,
        date: toDbDate(r.date),
        shiftCode: r.shiftCode,
        source: "GENERATOR",
      })),
    });
  }

  async saveGeneratedPreAllocations(
    scheduleMonthId: string,
    rows: Array<{ employeeUuid: string; date: string; label: string }>,
    skipKeys: Set<string>,
  ) {
    const toCreate = rows.filter((r) => {
      const key = `${r.employeeUuid}|${r.date}`;
      return !skipKeys.has(key);
    });
    if (toCreate.length === 0) return;
    await prisma.preAllocation.createMany({
      data: toCreate.map((r) => ({
        scheduleMonthId,
        employeeId: r.employeeUuid,
        date: toDbDate(r.date),
        label: r.label,
      })),
      skipDuplicates: true,
    });
  }

  async listShifts(activeOnly = false) {
    return prisma.shift.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
  }

  async listActiveEmployees() {
    const rows = await prisma.employee.findMany({
      where: { active: true },
      include: { role: true },
    });
    return [...rows].sort(compareEmployeesBySeniority);
  }

  async listRoles(activeOnly = true) {
    return prisma.role.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
  }

  /** Restrições permanentes de turno por funcionário (cadastro Funcionários). */
  async listShiftRestrictionsForMonth(_year: number, _month: number): Promise<ShiftRestrictionRow[]> {
    const rows = await prisma.employeeShiftRestriction.findMany({
      include: { shift: { select: { code: true } } },
    });
    return rows.map((r) => ({
      employeeUuid: r.employeeId,
      shiftCode: r.shift.code.toUpperCase(),
    }));
  }

  /** Preferências permanentes de turno por funcionário (cadastro Funcionários). */
  async listPreferredShiftsForMonth(_year: number, _month: number): Promise<import("../../domain/schedule/generation-types.js").PreferredShiftRow[]> {
    const rows = await prisma.employeePreferredShift.findMany({
      include: { shift: { select: { code: true } } },
    });
    return rows.map((r) => ({
      employeeUuid: r.employeeId,
      shiftCode: r.shift.code.toUpperCase(),
    }));
  }

  /** Turno em dias específicos — cadastro Funcionários. */
  async listSpecificShiftDayPreferencesForMonth(
    _year: number,
    _month: number,
  ): Promise<import("../../domain/schedule/generation-types.js").SpecificShiftDayPreferenceRow[]> {
    const rows = await prisma.employeeSpecificShiftRequest.findMany({
      include: { shift: { select: { code: true } } },
    });
    return rows.map((r) => ({
      employeeUuid: r.employeeId,
      shiftCode: r.shift.code.toUpperCase(),
      year: r.year,
      month: r.month,
      dayOfMonth: r.dayOfMonth,
      weekday: r.weekday,
    }));
  }

  /** Dias do mês em que funcionários não devem receber voo. */
  async listNoFlightDatesForMonth(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    const rows = await prisma.employeeFlightRestriction.findMany({
      where: { date: { gte: start, lte: end } },
      select: { employeeId: true, date: true },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }],
    });
    return rows.map((r) => ({
      employeeUuid: r.employeeId,
      date: isoDateKey(r.date),
    }));
  }

  /** Histórico operacional do mês anterior (últimos 15 dias) para continuidade. */
  async loadCrossMonthHistory(year: number, month: number): Promise<CrossMonthHistory> {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    const prev = await prisma.scheduleMonth.findUnique({
      where: { year_month: { year: prevYear, month: prevMonth } },
      include: {
        assignments: { orderBy: { date: "asc" } },
        preAllocations: { orderBy: { date: "asc" } },
      },
    });

    let assignments = prev
      ? filterHistoryByLookback(assignmentsFromDb(prev.assignments), year, month)
      : [];
    let allocations = prev
      ? filterHistoryByLookback(allocationsFromDb(prev.preAllocations), year, month)
      : [];

    const calendarAllocations = await this.loadCalendarCrossMonthAllocations(year, month);
    allocations = mergeCrossMonthAllocations(allocations, calendarAllocations);

    return { assignments, allocations };
  }

  /** Voos cadastrados no calendário do mês anterior (não duplicar preAllocations). */
  private async loadCalendarCrossMonthAllocations(
    targetYear: number,
    targetMonth: number,
  ): Promise<CrossMonthHistory["allocations"]> {
    const lookbackStart = lookbackStartDate(targetYear, targetMonth);
    const monthStart = iterDays(targetYear, targetMonth)[0];
    const start = toDbDate(lookbackStart);
    const end = toDbDate(addDays(monthStart, -1));

    const flights = await prisma.flightAssignment.findMany({
      where: { date: { gte: start, lte: end } },
      select: { employeeId: true, date: true },
      orderBy: { date: "asc" },
    });

    return flights.map((row) => ({
      employeeUuid: row.employeeId,
      date: isoDateKey(row.date),
      label: "VOO",
    }));
  }

  async saveViolations(
    scheduleMonthId: string,
    violations: Array<{
      severity: RuleSeverity;
      ruleCode: string;
      message: string;
      date?: string;
      employeeId?: string;
    }>,
  ) {
    await prisma.ruleViolation.deleteMany({ where: { scheduleMonthId } });
    if (violations.length === 0) return [];
    return prisma.ruleViolation.createMany({
      data: violations.map((v) => ({
        scheduleMonthId,
        severity: v.severity,
        ruleCode: v.ruleCode,
        message: v.message,
        date: v.date ?? null,
        employeeId: v.employeeId ?? null,
      })),
    });
  }

  /** Persiste pré-alocações fixas de continuidade T8/T8/ND no mês seguinte. */
  async saveCrossMonthContinuations(
    fromYear: number,
    fromMonth: number,
    rows: Array<{ employeeUuid: string; date: string; label: string }>,
  ) {
    if (rows.length === 0) return;

    const nextMonth = fromMonth === 12 ? 1 : fromMonth + 1;
    const nextYear = fromMonth === 12 ? fromYear + 1 : fromYear;
    const marker = `cross-month:${fromYear}-${fromMonth}`;

    const monthRecord = await this.ensureMonth(nextYear, nextMonth);

    await prisma.preAllocation.deleteMany({
      where: {
        scheduleMonthId: monthRecord.id,
        notes: marker,
      },
    });

    await prisma.preAllocation.createMany({
      data: rows.map((r) => ({
        scheduleMonthId: monthRecord.id,
        employeeId: r.employeeUuid,
        date: toDbDate(r.date),
        label: r.label,
        notes: marker,
      })),
      skipDuplicates: true,
    });
  }
}
