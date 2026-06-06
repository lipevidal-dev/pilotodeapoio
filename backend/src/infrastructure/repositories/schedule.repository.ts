import type { RuleSeverity } from "@prisma/client";
import type { ShiftRestrictionRow } from "../../domain/schedule/generation-types.js";
import {
  allocationsFromDb,
  assignmentsFromDb,
  filterHistoryByLookback,
  type CrossMonthHistory,
} from "../../domain/schedule/cross-month-history.js";
import {
  CLEAR_GENERATED_LABELS,
  REGENERATION_CLEAR_LABELS,
} from "../../domain/schedule/operational-labels.js";
import { toDbDate } from "../../domain/rules/date-keys.js";
import { prisma } from "../database/prisma-client.js";
export class ScheduleRepository {
  async findMonth(year: number, month: number) {
    return prisma.scheduleMonth.findUnique({
      where: { year_month: { year, month } },
      include: {
        assignments: { include: { employee: true }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: true }, orderBy: { date: "asc" } },
        ruleViolations: { orderBy: { createdAt: "desc" } },
      },
    });
  }

  async findMonthById(id: string) {
    return prisma.scheduleMonth.findUnique({
      where: { id },
      include: {
        assignments: { include: { employee: true }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: true }, orderBy: { date: "asc" } },
        ruleViolations: { orderBy: { createdAt: "desc" } },
      },
    });
  }

  async findPublishedMonth(year: number, month: number) {
    return prisma.scheduleMonth.findFirst({
      where: { year, month, status: "PUBLISHED" },
      include: {
        assignments: { include: { employee: true }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: true }, orderBy: { date: "asc" } },
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
      },
    });
  }

  async clearGeneratedData(scheduleMonthId: string) {
    await prisma.scheduleAssignment.deleteMany({
      where: { scheduleMonthId, source: "GENERATOR" },
    });
    await prisma.scheduleAssignment.deleteMany({
      where: {
        scheduleMonthId,
        OR: [
          { label: "VOO" },
          { label: { contains: "VOO", mode: "insensitive" } },
        ],
      },
    });
    await prisma.preAllocation.deleteMany({
      where: {
        scheduleMonthId,
        label: { in: [...CLEAR_GENERATED_LABELS] },
      },
    });
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
    return prisma.employee.findMany({
      where: { active: true },
      include: { role: true },
      orderBy: { name: "asc" },
    });
  }

  async listRoles(activeOnly = true) {
    return prisma.role.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
  }

  /**
   * Restrições mensais de turno por funcionário.
   * Origem: tabela legada `shift_restrictions` (quando presente no banco).
   */
  async listShiftRestrictionsForMonth(year: number, month: number): Promise<ShiftRestrictionRow[]> {
    try {
      const rows = await prisma.$queryRaw<{ employee_id: string; shift_code: string }[]>`
        SELECT employee_id, shift_code
        FROM shift_restrictions
        WHERE year = ${year} AND month = ${month}
      `;
      return rows.map((r) => ({
        employeeUuid: r.employee_id,
        shiftCode: String(r.shift_code).toUpperCase(),
      }));
    } catch {
      return [];
    }
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

    if (!prev || prev.status === "DRAFT") {
      return { assignments: [], allocations: [] };
    }

    const assignments = filterHistoryByLookback(
      assignmentsFromDb(prev.assignments),
      year,
      month,
    );
    const allocations = filterHistoryByLookback(
      allocationsFromDb(prev.preAllocations),
      year,
      month,
    );

    return { assignments, allocations };
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
}
